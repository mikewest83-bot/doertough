/**
 * Safe execution boundary for Mike tools.
 * The model never receives direct access to arbitrary functions.
 * Callers register only the handlers they explicitly intend to expose.
 */
const DEFAULT_REPO = 'mikewest83-bot/doertough';

function redactSecrets(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, '[REDACTED_OPENAI_KEY]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(github_pat_[A-Za-z0-9_]{20,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/((?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[=:]\s*["']?)[^\s"']+/gi, '$1[REDACTED]');
}

function redactToolOutput(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactToolOutput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(?:key|secret|token|password|credential)/i.test(key) ? '[REDACTED]' : redactToolOutput(item)]));
  return value;
}

export function createMikeToolGateway({ handlers = {}, authorize = async () => true } = {}) {
  const registry = new Map(Object.entries(handlers).filter(([, fn]) => typeof fn === 'function'));

  return {
    list() { return [...registry.keys()]; },

    async execute({ name, args = {}, user = null } = {}) {
      if (!name || !registry.has(name)) throw new Error('mike_tool_not_allowed');
      const permitted = await authorize({ name, args, user });
      if (!permitted) throw new Error('mike_tool_unauthorized');

      if (name === 'code_repo_status') {
        const repo = String(args?.repo || DEFAULT_REPO).trim();
        if (repo !== DEFAULT_REPO) throw new Error('repository_not_allowed');
      }
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
        const result = await registry.get(name)({ ...args, user });
        return name.startsWith('code_') ? redactToolOutput(result) : result;
      } catch (error) {
        console.error(`[mike-tool] ${name} failed:`, error?.message || error);
        if (error?.message === 'mike_tool_unauthorized') throw error;
        throw error;
      }
    }
  };
}
