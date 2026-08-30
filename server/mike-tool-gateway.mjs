/**
 * Safe execution boundary for Mike tools.
 * The model never receives direct access to arbitrary functions.
 * Callers register only the handlers they explicitly intend to expose.
 */
export function createMikeToolGateway({ handlers = {}, authorize = async () => true } = {}) {
  const registry = new Map(Object.entries(handlers).filter(([, fn]) => typeof fn === 'function'));

  return {
    list() { return [...registry.keys()]; },

    async execute({ name, args = {}, user = null } = {}) {
      if (!name || !registry.has(name)) throw new Error('mike_tool_not_allowed');
      const permitted = await authorize({ name, args, user });
      if (!permitted) throw new Error('mike_tool_unauthorized');

      if (name === 'code_write_file') {
        const path = String(args?.path || '').trim();
        const branch = String(args?.branch || '').trim();
        const content = String(args?.content ?? '');
        if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error('unsafe_path');
        if (/^\.github\/workflows(?:\/|$)/i.test(path)) throw new Error('workflow_path_blocked');
        if (!content.trim()) throw new Error('empty_content_blocked');
        if (!branch || /^(?:main|master|production)(?:\/|$)/i.test(branch)) throw new Error('production_branch_blocked');
      }
      if (name === 'code_create_branch') {
        const branch = String(args?.branch || '').trim();
        if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(branch) || /^(?:main|master|production)(?:\/|$)/i.test(branch)) throw new Error('unsafe_branch');
      }

      try {
        return await registry.get(name)({ ...args, user });
      } catch (error) {
        console.error(`[mike-tool] ${name} failed:`, error?.message || error);
        if (error?.message === 'mike_tool_unauthorized') throw error;
        throw error;
      }
    }
  };
}
