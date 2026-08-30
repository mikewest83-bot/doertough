import fs from 'fs';

const file = 'server/live.mjs';
let source = fs.readFileSync(file, 'utf8');

if (!source.includes("from './google-oauth.mjs'")) {
  const marker = "import { CODING_TOOLS, CODING_TOOL_HANDLERS } from './coding-tools.mjs';";
  if (!source.includes(marker)) throw new Error('[google-tools] coding import marker not found');
  source = source.replace(marker, `${marker}\nimport { getGoogleAccessToken } from './google-oauth.mjs';`);
}

const marker = 'export const LIVE_TOOLS = [';
if (!source.includes(marker)) throw new Error('[google-tools] LIVE_TOOLS marker not found');

const helpers = `
async function googleApi(path, userId, options = {}) {
  if (!userId) throw new Error('sign_in_required');
  const token = await getGoogleAccessToken(userId);
  const response = await fetch(\`https://www.googleapis.com\${path}\`, {
    ...options,
    headers: { authorization: \`Bearer \${token}\`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || \`google_api_\${response.status}\`);
  return data;
}

export async function googleGmailSearch({ query = '', maxResults = 10, user } = {}) {
  const q = String(query || '').trim();
  const max = Math.min(Math.max(Number(maxResults) || 10, 1), 20);
  const params = new URLSearchParams({ maxResults: String(max) });
  if (q) params.set('q', q);
  const list = await googleApi(\`/gmail/v1/users/me/messages?\${params.toString()}\`, user?.id);
  const messages = [];
  for (const item of (list.messages || []).slice(0, max)) {
    const message = await googleApi(\`/gmail/v1/users/me/messages/\${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date\`, user?.id);
    const headers = Object.fromEntries((message.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    messages.push({ id: item.id, threadId: item.threadId, from: headers.from || '', to: headers.to || '', subject: headers.subject || '(no subject)', date: headers.date || '', snippet: message.snippet || '' });
  }
  return { query: q || null, count: messages.length, messages };
}

export async function googleCalendarEvents({ days = 7, user } = {}) {
  const span = Math.min(Math.max(Number(days) || 7, 1), 31);
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + span * 86400000);
  const params = new URLSearchParams({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const data = await googleApi(\`/calendar/v3/calendars/primary/events?\${params.toString()}\`, user?.id);
  return { days: span, events: (data.items || []).map((event) => ({ id: event.id, title: event.summary || '(untitled)', start: event.start?.dateTime || event.start?.date || null, end: event.end?.dateTime || event.end?.date || null, location: event.location || '', description: event.description || '', status: event.status })) };
}

export async function googleGmailCreateDraft({ to, subject, body, user } = {}) {
  const recipient = String(to || '').trim();
  const title = String(subject || '').trim();
  const text = String(body || '').trim();
  if (!recipient || !title || !text) throw new Error('draft_requires_to_subject_body');
  const raw = [
    \`To: \${recipient}\`,
    \`Subject: \${title}\`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    text,
  ].join('\\r\\n');
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');
  const data = await googleApi('/gmail/v1/users/me/drafts', user?.id, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: { raw: encoded } }),
  });
  return { draftCreated: true, draftId: data.id, messageId: data.message?.id, note: 'Draft created. Mike will not send it without an explicit send action.' };
}

`;
if (!source.includes('export async function googleGmailSearch')) {
  source = source.replace(marker, `${helpers}${marker}`);
}

const toolMarker = "  { type:'function', name:'get_weather'";
const toolEntries = `  { type:'function', name:'google_gmail_search', description:'Search the signed-in user\'s Gmail. Only use after the user has connected Google. Return concise email metadata and snippets.', parameters:{ type:'object', properties:{ query:{ type:'string', description:'Gmail search query, e.g. from:john@example.com newer_than:7d or is:unread.' }, maxResults:{ type:'integer', minimum:1, maximum:20, description:'Maximum number of messages to return.' } }, required:[], additionalProperties:false } },
  { type:'function', name:'google_calendar_events', description:'Read the signed-in user\'s primary Google Calendar for the next several days.', parameters:{ type:'object', properties:{ days:{ type:'integer', minimum:1, maximum:31, description:'Number of future days to inspect.' } }, required:[], additionalProperties:false } },
  { type:'function', name:'google_gmail_create_draft', description:'Create a Gmail draft for the signed-in user. This tool creates a draft only and never sends email.', parameters:{ type:'object', properties:{ to:{ type:'string', description:'Recipient email address.' }, subject:{ type:'string', description:'Email subject.' }, body:{ type:'string', description:'Email body.' } }, required:['to','subject','body'], additionalProperties:false } },
`;
if (!source.includes("name:'google_gmail_search'")) {
  if (!source.includes(toolMarker)) throw new Error('[google-tools] weather tool marker not found');
  source = source.replace(toolMarker, toolEntries + toolMarker);
}

const handlerMarker = 'export const LIVE_TOOL_HANDLERS = {';
const handlers = `  google_gmail_search: googleGmailSearch,
  google_calendar_events: googleCalendarEvents,
  google_gmail_create_draft: googleGmailCreateDraft,
`;
if (!source.includes("google_gmail_search: googleGmailSearch")) {
  if (!source.includes(handlerMarker)) throw new Error('[google-tools] handler marker not found');
  source = source.replace(handlerMarker, `${handlerMarker}\n${handlers}`);
}

fs.writeFileSync(file, source);
console.log('[google-tools] personal Google Gmail/Calendar tools patched into live tool registry');
