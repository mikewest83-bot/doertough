import fs from 'node:fs';

// Deal-alert / "Watch It for Me" UI is intentionally disabled for now.
// Keep this build patch as a no-op so the feature cannot be reintroduced by
// a later build from the preserved deal-finder backend code.
process.stdout.write('[build] Watch It for Me UI disabled\n');
