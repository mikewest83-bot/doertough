import fs from 'fs';

const file = 'server/live.mjs';
let source = fs.readFileSync(file, 'utf8');

// The Google tool descriptions are single-quoted JavaScript strings. Escape
// the apostrophe in "user's" so Node can parse the module at startup.
source = source.replace(
  "description:'Search the signed-in user's Gmail.",
  'description:"Search the signed-in user\\'s Gmail.'
);
source = source.replace(
  "description:'Read the signed-in user's primary Google Calendar",
  'description:"Read the signed-in user\\'s primary Google Calendar'
);

fs.writeFileSync(file, source);
console.log('[google-tools] syntax normalization complete');
