import fs from 'node:fs';

// Deal alerts are disabled for now. Keep this normalization script as a no-op
// so preserved backend code cannot be reintroduced into the production tool
// registry by the build pipeline.
console.log('[deal-alert-import] deal alerts disabled');
