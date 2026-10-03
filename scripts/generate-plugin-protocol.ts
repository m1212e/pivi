// Regenerates docs/plugin-protocol.schema.json from the zod schemas in
// src/lib/plugins. Run with `bun run plugins:protocol`.
import { writeFileSync } from 'node:fs';
import { buildProtocolDocument } from '../src/lib/plugins/protocolSchema';

const target = new URL('../docs/plugin-protocol.schema.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(buildProtocolDocument(), null, '\t')}\n`);
console.log(`Wrote ${target.pathname}`);
