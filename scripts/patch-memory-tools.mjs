import fs from 'fs';

const patches = [
  {
    path: 'server/index.mjs',
    steps: [
      {
        old: "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';",
        next: "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';\nimport { MEMORY_TOOLS, MEMORY_TOOL_HANDLERS } from './memory-tools.mjs';",
        label: 'memory import',
      },
      {
        old: '  ...DEAL_ALERT_TOOLS,\n];',
        next: '  ...DEAL_ALERT_TOOLS,\n  ...MEMORY_TOOLS,\n];',
        label: 'memory tool definitions',
      },
      {
        old: '  ...DEAL_FINDER_HANDLERS,\n  ...ACCOUNT_SCOPED_TOOL_HANDLERS,\n};',
        next: '  ...DEAL_FINDER_HANDLERS,\n  ...ACCOUNT_SCOPED_TOOL_HANDLERS,\n  ...Object.fromEntries(Object.entries(MEMORY_TOOL_HANDLERS).map(([name, handler]) => [\n    name,\n    (args = {}) => handler(args, { user: args?.user }),\n  ])),\n};',
        label: 'memory handlers',
      },
    ],
  },
  {
    path: 'server/realtime-tools.mjs',
    steps: [
      {
        old: "import { isOwner } from './auth.mjs';",
        next: "import { isOwner } from './auth.mjs';\nimport { MEMORY_TOOLS, MEMORY_TOOL_HANDLERS } from './memory-tools.mjs';",
        label: 'memory import',
      },
      {
        old: '  ...DEEP_THINK_TOOLS,\n].filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));',
        next: '  ...DEEP_THINK_TOOLS,\n  ...MEMORY_TOOLS,\n].filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));',
        label: 'memory tool definitions',
      },
      {
        old: '  ...DEEP_THINK_HANDLERS,\n};',
        next: '  ...DEEP_THINK_HANDLERS,\n  ...Object.fromEntries(Object.entries(MEMORY_TOOL_HANDLERS).map(([name, handler]) => [\n    name,\n    (args = {}) => handler(args, { user: args?.user }),\n  ])),\n};',
        label: 'memory handlers',
      },
    ],
  },
];

for (const patch of patches) {
  let source = fs.readFileSync(patch.path, 'utf8');
  for (const step of patch.steps) {
    if (source.includes(step.next)) continue;
    if (!source.includes(step.old)) throw new Error(`[memory-tools] ${patch.path}: anchor not found for ${step.label}`);
    source = source.replace(step.old, step.next);
  }
  fs.writeFileSync(patch.path, source);
  console.log(`[memory-tools] patched ${patch.path}`);
}
