// Owner-only coding tools for Mike AI.
// Reads and writes are authenticated, repo-scoped, and guarded against secrets.
// Authorization is enforced both by the gateway and inside each handler.

import { isOwner } from './auth.mjs';

const DEFAULT_REPO = 'mikewest83-bot/doertough';
const API_ROOT = 'https://api.github.com';

function repoName(value) {
  return String(value || DEFAULT_REPO).trim() || DEFAULT_REPO;
}

function allowedRepos() {
  const configured = String(process.env.CODE_ALLOWED_REPOS || DEFAULT_REPO)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured);
}

function assertAllowedRepo(value) {
  const repo = repoName(value);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('unsafe_repo');
  if (!allowedRepos().has(repo)) throw new Error('repo_not_allowed');
  return repo;
}

function assertOwner(user) {
  if (!isOwner(user)) throw new Error('mike_tool_unauthorized');
}

async function githubFetch(path, options = {}) {
  if (!process.env.GITHUB_TOKEN) throw new Error('github_token_not_configured');
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw: raw.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`github_${response.status}`);
  return data;
}

function requireWriteAccess() {
  if (!process.env.GITHUB_TOKEN) throw new Error('github_write_not_configured');
}

function assertSafePath(filePath) {
  const value = String(filePath || '').trim();
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\\')) throw new Error('unsafe_path');
  return value;
}

function assertSafeWritePath(filePath) {
  const value = assertSafePath(filePath);
  if (/^\.github\/workflows(?:\/|$)/i.test(value)) throw new Error('workflow_path_blocked');
  return value;
}

function scrubSecrets(value) {
  return String(value || '')
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, '[REDACTED_API_KEY]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(github_pat_[A-Za-z0-9_]{20,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(xox[baprs]-[A-Za-z0-9-]{20,})/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/(AKIA[0-9A-Z]{16})/g, '[REDACTED_AWS_KEY]')
    .replace(/(-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]+ PRIVATE KEY-----)/g, '$1[REDACTED_PRIVATE_KEY]$2')
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?)[^\s"'&,}]+/gi, '$1[REDACTED]');
}

export const CODING_TOOLS = [
  { type:'function', name:'code_repo_status', description:'Inspect the configured Mike AI GitHub repository metadata and default branch. Owner only.', parameters:{ type:'object', properties:{ repo:{ type:'string', description:'Optional owner/name repository. Must be allowlisted.' } }, required:[], additionalProperties:false } },
  { type:'function', name:'code_read_file', description:'Read a text file from the allowlisted Mike AI GitHub repository. Owner only.', parameters:{ type:'object', properties:{ path:{ type:'string', description:'Repository-relative file path.' }, ref:{ type:'string', description:'Optional branch, tag, or commit SHA.' } }, required:['path'], additionalProperties:false } },
  { type:'function', name:'code_search', description:'Search the allowlisted Mike AI GitHub repository for code or configuration text. Owner only.', parameters:{ type:'object', properties:{ query:{ type:'string', description:'Search terms.' }, topn:{ type:'integer', minimum:1, maximum:20, description:'Maximum results.' } }, required:['query'], additionalProperties:false } },
  { type:'function', name:'code_create_branch', description:'Create a new Git branch from an existing ref. Owner only; requires configured GitHub write credentials.', parameters:{ type:'object', properties:{ branch:{ type:'string', description:'New branch name.' }, base:{ type:'string', description:'Existing branch, tag, or commit SHA. Defaults to main.' } }, required:['branch'], additionalProperties:false } },
  { type:'function', name:'code_write_file', description:'Write or update one repository text file. Owner only; requires configured GitHub write credentials. Never use this for secrets.', parameters:{ type:'object', properties:{ path:{ type:'string', description:'Repository-relative file path.' }, content:{ type:'string', description:'Complete UTF-8 file contents.' }, message:{ type:'string', description:'Commit message.' }, branch:{ type:'string', description:'Target branch. Prefer a feature branch; production branches are blocked.' } }, required:['path','content','message','branch'], additionalProperties:false } },
];

async function codeRepoStatus({ repo, user } = {}) {
  assertOwner(user);
  const data = await githubFetch(`/repos/${assertAllowedRepo(repo)}`);
  return { repository: data.full_name, private: !!data.private, defaultBranch: data.default_branch, visibility: data.visibility, archived: !!data.archived };
}

async function codeReadFile({ path, ref, user } = {}) {
  assertOwner(user);
  const safe = assertSafePath(path);
  const repo = assertAllowedRepo();
  const suffix = ref ? `?ref=${encodeURIComponent(String(ref))}` : '';
  const data = await githubFetch(`/repos/${repo}/contents/${safe}${suffix}`);
  if (Array.isArray(data) || data.type !== 'file') throw new Error('github_file_not_text');
  if (data.encoding !== 'base64' || !data.content) return { path: safe, content: '', sha: data.sha };
  const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  const scrubbed = scrubSecrets(content);
  return { path: safe, sha: data.sha, content: scrubbed.slice(0, 50000), truncated: scrubbed.length > 50000 };
}

async function codeSearch({ query, topn = 10, user } = {}) {
  assertOwner(user);
  const q = String(query || '').trim();
  if (!q) throw new Error('search_query_required');
  const repo = assertAllowedRepo();
  const data = await githubFetch(`/search/code?q=${encodeURIComponent(`${q} repo:${repo}`)}&per_page=${Math.min(20, Math.max(1, Number(topn) || 10))}`);
  return { total: data.total_count || 0, results: (data.items || []).map((item) => ({ path: item.path, url: item.html_url, repository: item.repository?.full_name })) };
}

async function codeCreateBranch({ branch, base = 'main', user } = {}) {
  assertOwner(user);
  requireWriteAccess();
  const repo = assertAllowedRepo();
  const name = String(branch || '').trim();
  if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(name) || /^(?:main|master|production)(?:\/|$)/i.test(name)) throw new Error('unsafe_branch');
  const baseData = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(String(base))}`);
  const sha = baseData.object?.sha;
  if (!sha) throw new Error('base_ref_not_found');
  const created = await githubFetch(`/repos/${repo}/git/refs`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ref:`refs/heads/${name}`, sha }) });
  return { branch:name, sha:created.object?.sha || sha };
}

async function codeWriteFile({ path, content, message, branch, user } = {}) {
  assertOwner(user);
  requireWriteAccess();
  const safe = assertSafeWritePath(path);
  const target = String(branch || '').trim();
  if (!target || /^(?:main|master|production)(?:\/|$)/i.test(target)) throw new Error('production_branch_blocked');
  const repo = assertAllowedRepo();
  const cleanContent = String(content || '');
  if (!cleanContent.trim()) throw new Error('empty_content_blocked');
  let existing = null;
  try { existing = await githubFetch(`/repos/${repo}/contents/${safe}?ref=${encodeURIComponent(target)}`); } catch (error) { if (error.message !== 'github_404') throw error; }
  const payload = { message:String(message || 'Update file'), content:Buffer.from(cleanContent,'utf8').toString('base64'), branch:target };
  if (existing?.sha) payload.sha = existing.sha;
  const result = await githubFetch(`/repos/${repo}/contents/${safe}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  return { path:safe, branch:target, commitSha:result.commit?.sha || null, url:result.content?.html_url || null };
}

export const CODING_TOOL_HANDLERS = Object.freeze({
  code_repo_status: codeRepoStatus,
  code_read_file: codeReadFile,
  code_search: codeSearch,
  code_create_branch: codeCreateBranch,
  code_write_file: codeWriteFile,
});
