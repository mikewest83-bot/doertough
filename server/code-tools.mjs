// server/code-tools.mjs
//
// Owner-only tools that let Mike AI read the doertough codebase and DRAFT
// changes for review. These never touch GitHub. Every direct-write attempt
// made against this repo today returned 403 - automated systems cannot push
// here, on purpose - and even where that weren't true, a one-click
// AI-authored commit straight to a live paid product is exactly the failure
// mode this file exists to avoid. Every draft lands in a database table for
// a human to read and apply by hand - same motion as every fix shipped today,
// just without needing a separate conversation to get there.
//
// Env:
//   GITHUB_TOKEN  Required for these tools to work. A fine-grained PAT
//                 scoped to READ-ONLY "Contents" access on exactly this
//                 repo. No write scopes needed or wanted - these tools
//                 never call a write endpoint.
//   GITHUB_REPO   Optional. Defaults to 'mikewest83-bot/doertough'.

import { createTwoFilesPatch } from 'diff';
import {
  createCodeDraft,
  listCodeDrafts as dbListCodeDrafts,
  getCodeDraft as dbGetCodeDraft,
} from './db.mjs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'mikewest83-bot/doertough';
const TIMEOUT_MS = 10000;
const MAX_CHARS = 60000;

export const codeToolsConfigured = () => !!GITHUB_TOKEN;

const ALLOWED_PREFIXES = ['server/', 'src/', 'public/'];
const ALLOWED_ROOT_FILES = new Set([
  'package.json', 'index.html', 'README.md',
  'privacy.html', 'terms.html', 'refunds.html', 'support.html',
]);
const DENY_PATTERN = /\.env|secret|credential|(?:^|[^a-z])token(?:[^a-z]|$)|(?:^|[^a-z])key(?:[^a-z]|$)/i;

function checkPathAllowed(path) {
  const p = String(path || '').trim();
  if (!p) return 'A file path is required.';
  if (p.includes('..') || p.startsWith('/') || p.startsWith('.github/')) {
    return `"${p}" is outside what these tools can reach.`;
  }
  if (DENY_PATTERN.test(p)) {
    return `"${p}" looks like it could hold a secret - these tools refuse that class of file on purpose.`;
  }
  const allowed = ALLOWED_ROOT_FILES.has(p) || ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix));
  if (!allowed) {
    return `"${p}" is outside what these tools can reach. Allowed: server/, src/, public/, or a root config/legal file.`;
  }
  return null;
}

async function fetchFromGithub(path) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'mike-ai-code-tools',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return { content: await res.text() };
}

export async function readCodeFile({ path } = {}) {
  if (!GITHUB_TOKEN) return { error: 'not_configured', note: 'Code reading is not set up yet.' };

  const denied = checkPathAllowed(path);
  if (denied) return { error: denied };

  try {
    const result = await fetchFromGithub(path);
    if (result.notFound) return { error: `No file at "${path}" on main.` };

    const truncated = result.content.length > MAX_CHARS;
    return {
      path,
      content: truncated ? result.content.slice(0, MAX_CHARS) : result.content,
      truncated,
      note: truncated ? `Truncated at ${MAX_CHARS} characters - the real file is longer.` : undefined,
    };
  } catch (err) {
    console.error('[code-tools] readCodeFile failed:', err.message || err);
    return { error: 'Could not reach GitHub right now.' };
  }
}

export async function listCodeFiles({ directory } = {}) {
  if (!GITHUB_TOKEN) return { error: 'not_configured', note: 'Code reading is not set up yet.' };

  const dir = String(directory || 'server').replace(/\/+$/, '');
  const denied = checkPathAllowed(dir + '/');
  if (denied) return { error: denied };

  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(dir)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mike-ai-code-tools',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { error: `No directory at "${dir}".` };
    if (!res.ok) return { error: `GitHub returned ${res.status}.` };

    const listing = await res.json();
    if (!Array.isArray(listing)) return { error: `"${dir}" is a file, not a directory.` };

    return {
      directory: dir,
      files: listing.map((item) => ({ name: item.name, type: item.type, size: item.size })),
    };
  } catch (err) {
    console.error('[code-tools] listCodeFiles failed:', err.message || err);
    return { error: 'Could not reach GitHub right now.' };
  }
}

export async function saveCodeDraft({ path, description, newContent } = {}) {
  if (!GITHUB_TOKEN) return { error: 'not_configured', note: 'Code drafting is not set up yet.' };

  const denied = checkPathAllowed(path);
  if (denied) return { error: denied };
  if (!newContent || typeof newContent !== 'string') {
    return { error: 'newContent is required and must be the complete file, not a snippet.' };
  }
  if (newContent.length > MAX_CHARS) {
    return { error: `That draft is too large (${newContent.length} chars, max ${MAX_CHARS}).` };
  }

  let oldContent = '';
  let isNewFile = false;
  try {
    const result = await fetchFromGithub(path);
    if (result.notFound) isNewFile = true;
    else oldContent = result.content;
  } catch (err) {
    console.error('[code-tools] saveCodeDraft fetch failed:', err.message || err);
    return { error: 'Could not read the current file from GitHub to diff against.' };
  }

  if (!isNewFile && oldContent === newContent) {
    return { error: 'That draft is identical to the current file - nothing to save.' };
  }

  const diffText = createTwoFilesPatch(path, path, oldContent, newContent, isNewFile ? '(new file)' : 'current', 'draft');
  const linesChanged = diffText.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l)).length;

  try {
    const draft = await createCodeDraft({
      path,
      description: String(description || '').slice(0, 500),
      oldContent,
      newContent,
      diffText,
      isNewFile,
    });
    return {
      id: draft.id,
      path,
      isNewFile,
      linesChanged,
      note: `Draft saved for ${path} (${linesChanged} line${linesChanged === 1 ? '' : 's'} changed). Review it in the Code Drafts panel - nothing has been applied anywhere.`,
    };
  } catch (err) {
    console.error('[code-tools] saveCodeDraft insert failed:', err.message || err);
    return { error: 'Could not save that draft.' };
  }
}

export async function listCodeDrafts() {
  const drafts = await dbListCodeDrafts();
  return { drafts: drafts.map((d) => ({ id: d.id, path: d.path, description: d.description, created_at: d.created_at, status: d.status })) };
}

export async function getCodeDraftById(id) {
  return dbGetCodeDraft(id);
}

export const CODE_TOOLS = [
  {
    type: 'function',
    name: 'read_code_file',
    description: "Read a file from Mike's own doertough codebase on GitHub (main branch). Owner only. Use this to answer questions about how something works before proposing a change.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "File path from the repo root, e.g. 'server/persona.mjs' or 'src/main.jsx'." },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_code_files',
    description: "List files in a directory of Mike's own codebase (e.g. 'server' or 'src'). Owner only.",
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: "Directory path, e.g. 'server'. Defaults to 'server'." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'save_code_draft',
    description: 'Save a proposed code change as a DRAFT for the owner to review and apply by hand - this never modifies GitHub or the live app. Always read_code_file first so newContent is a complete, correct file built on the real current version, not a guess.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path this draft is for.' },
        description: { type: 'string', description: 'One or two sentences on what this change does and why.' },
        newContent: { type: 'string', description: 'The COMPLETE new file content, not a diff or snippet.' },
      },
      required: ['path', 'description', 'newContent'],
      additionalProperties: false,
    },
  },
];

export const CODE_TOOL_HANDLERS = {
  read_code_file: readCodeFile,
  list_code_files: listCodeFiles,
  save_code_draft: saveCodeDraft,
};
