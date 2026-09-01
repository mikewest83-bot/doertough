import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'deal-alerts.mjs');
let source = fs.readFileSync(target, 'utf8');

const importNeedle = "import { findLocalDeals } from './deal-finder.mjs';";
const importLine = "import { sendResaleDealAlert } from './mailer.mjs';";
if (!source.includes(importLine)) {
  if (!source.includes(importNeedle)) throw new Error('[patch-deal-alert-email] deal-finder import anchor not found');
  source = source.replace(importNeedle, `${importNeedle}\n${importLine}`);
}

if (!source.includes('let emailed = 0;')) {
  source = source.replace('  let matched = 0;\n', '  let matched = 0;\n  let emailed = 0;\n');
}

const oldBlock = `      await query('UPDATE deal_alerts SET notified_urls=$2::jsonb,last_notified_at=now(),updated_at=now() WHERE id=$1', [alert.id, JSON.stringify([...new Set([...previous, ...fresh.map((x) => x.url)])].slice(-200))]);\n      matched += 1;\n      console.log(\`[deal-alerts] alert #\${alert.id} found \${fresh.length} new resale candidate(s)\${score == null ? '' : \` score=\${score}/100\`}\`);`;

const newBlock = `      const opportunities = fresh.map((item) => ({\n        title: item.title || 'Potential resale deal',\n        askingPrice: item.askingPrice,\n        resaleExpected: item.resaleExpected,\n        estimatedProfit: item.estimatedProfit,\n        roiPercent: item.roiPercent,\n        why: item.why || 'New listing found by Mike AI.',\n        redFlags: item.redFlags || 'Verify listing condition and seller details.',\n        url: item.url,\n      }));\n      const mail = await sendResaleDealAlert({\n        to: alert.email,\n        name: alert.name,\n        location: alert.location,\n        radiusMiles: alert.radius_miles == null ? DEFAULT_RADIUS : alert.radius_miles,\n        opportunities,\n      });\n      if (!mail?.sent) {\n        console.warn(\`[deal-alerts] alert #\${alert.id} found \${fresh.length} new candidate(s) but email was not sent: \${mail?.reason || 'unknown'}\`);\n        continue;\n      }\n      await query('UPDATE deal_alerts SET notified_urls=$2::jsonb,last_notified_at=now(),updated_at=now() WHERE id=$1', [alert.id, JSON.stringify([...new Set([...previous, ...fresh.map((x) => x.url)])].slice(-200))]);\n      matched += 1;\n      emailed += 1;\n      console.log(\`[deal-alerts] alert #\${alert.id} found \${fresh.length} new resale candidate(s)\${score == null ? '' : \` score=\${score}/100\`} email_sent=true\`);`;

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) throw new Error('[patch-deal-alert-email] notification block not found');
  source = source.replace(oldBlock, newBlock);
}

source = source.replace('return { checked, matched };', 'return { checked, matched, emailed };');
source = source.replace('if (result.checked || result.matched) console.log(`[deal-alerts] checked=${result.checked} matched=${result.matched}`);', 'if (result.checked || result.matched) console.log(`[deal-alerts] checked=${result.checked} matched=${result.matched} emails=${result.emailed}`);');

fs.writeFileSync(target, source);
console.log('[patch-deal-alert-email] outbound email wired with send-success gating');
