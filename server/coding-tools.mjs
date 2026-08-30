// Owner-only coding tools for Mike AI.
// Read operations use the public GitHub API; write operations require GITHUB_TOKEN.
// All tools are additionally gated by the server's owner check before execution.

const DEFAULT_REPO = 'mikewest83-bot/doertough';
const API_ROOT = 'https://api.github.com';

function repoName(value) {
  return String(value || DEFAULT_REPO).trim() || DEFAULT_REPO;
}

async function githubFetch(path, options = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
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

export const CODING_TOOLS = [
  { type:'function', name:'code_repo_status', description:'Inspect the configured Mike AI GitHub repository metadata and default branch. Owner only.', parameters:{ type:'object', properties:{ repo:{ type:'string', description:'Optional owner/name repository. Defaults to Mike AI.' } }, required:[], additionalProperties:false } },
  { type:'function', name:'code_read_file', description:'Read a text file from the Mike AI GitHub repository. Owner only.', parameters:{ type:'object', properties:{ path:{ type:'string', description:'Repository-relative file path.' }, ref:{ type:'string', description:'Optional branch, tag, or commit SHA.' } }, required:['path'], additionalProperties:false } },
  { type:'function', name:'code_search', description:'Search the Mike AI GitHub repository for code or configuration text. Owner only.', parameters:{ type:'object', properties:{ query:{ type:'string', description:'Search terms.' }, topn:{ type:'integer', minimum:1, maximum:20, description:'Maximum results.' } }, required:['query'], additionalProperties:false } },
  { type:'function', name:'code_create_branch', description:'Create a new Git branch from an existing ref. Owner only; requires configured GitHub write credentials.', parameters:{ type:'object', properties:{ branch:{ type:'string', description:'New branch name.' }, base:{ type:'string', description:'Existing branch, tag, or commit SHA. Defaults to main.' } }, required:['branch'], additionalProperties:false } },
  { type:'function', name:'code_write_file', description:'Write or update one repository text file. Owner only; requires configured GitHub write credentials. Never use this for secrets.', parameters:{ type:'object', properties:{ path:{ type:'string', description:'Repository-relative file path.' }, content:{ type:'string', description:'Complete UTF-8 file contents.' }, message:{ type:'string', description:'Commit message.' }, branch:{ type:'string', description:'Target branch. Prefer a feature branch, never production directly.' } }, required:['path','content','message','branch'], additionalProperties:false } },
];

async function codeRepoStatus({ repo } = {}) {
  const data = await githubFetch(`/repos/${repoName(repo)}`);
  return { repository: data.full_name, private: !!data.private, defaultBranch: data.default_branch, visibility: data.visibility, archived: !!data.archived };
}

async function codeReadFile({ path, ref } = {}) {
  const safe = assertSafePath(path);
  const repo = repoName();
  const suffix = ref ? `?ref=${encodeURIComponent(String(ref))}` : '';
  const data = await githubFetch(`/repos/${repo}/contents/${safe}${suffix}`);
  if (Array.isArray(data) || data.type !== 'file') throw new Error('github_file_not_text');
  if (data.encoding !== 'base64' || !data.content) return { path: safe, content: data.content || '', sha: data.sha };
  const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  return { path: safe, sha: data.sha, content: content.slice(0, 50000), truncated: content.length > 50000 };
}

async function codeSearch({ query, topn = 10 } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('search_query_required');
  const data = await githubFetch(`/search/code?q=${encodeURIComponent(`${q} repo:${repoName()}`)}&per_page=${Math.min(20, Math.max(1, Number(topn) || 10))}`);
  return { total: data.total_count || 0, results: (data.items || []).map((item) => ({ path: item.path, url: item.html_url, repository: item.repository?.full_name })) };
}

async function codeCreateBranch({ branch, base = 'main' } = {}) {
  requireWriteAccess();
  const name = String(branch || '').trim();
  if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(name) || name === 'main' || name.startsWith('main/')) throw new Error('unsafe_branch');
  const baseData = await githubFetch(`/repos/${repoName()}/git/ref/heads/${encodeURIComponent(String(base))}`);
  const sha = baseData.object?.sha;
  if (!sha) throw new Error('base_ref_not_found');
  const created = await githubFetch(`/repos/${repoName()}/git/refs`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ref:`refs/heads/${name}`, sha }) });
  return { branch:name, sha:created.object?.sha || sha };
}

async function codeWriteFile({ path, content, message, branch } = {}) {
  requireWriteAccess();
  const safe = assertSafePath(path);
  const target = String(branch || '').trim();
  if (!target || target === 'main' || target.startsWith('main/')) throw new Error('production_branch_blocked');
  const repo = repoName();
  let existing = null;
  try { existing = await githubFetch(`/repos/${repo}/contents/${safe}?ref=${encodeURIComponent(target)}`); } catch (error) { if (error.message !== 'github_404') throw error; }
  const payload = { message:String(message || 'Update file'), content:Buffer.from(String(content || ''),'utf8').toString('base64'), branch:target };
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
