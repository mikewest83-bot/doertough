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
      if (!name || !registry.has(name)) {
        throw new Error('mike_tool_not_allowed');
      }
      const permitted = await authorize({ name, args, user });
      if (!permitted) throw new Error('mike_tool_unauthorized');

      try {
        return await registry.get(name)({ ...args, user });
      } catch (error) {
        console.error(`[mike-tool] ${name} failed:`, error?.message || error);
        throw new Error('mike_tool_failed');
      }
    }
  };
}
