// Regenerates docs/app-protocol.schema.json from the zod schemas in
// src/lib/apps. Run with `bun run apps:protocol`.
import { writeFileSync } from 'node:fs';
import { buildProtocolDocument } from '../src/lib/apps/protocolSchema';

const target = new URL('../docs/app-protocol.schema.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(buildProtocolDocument(), null, '\t')}\n`);
console.log(`Wrote ${target.pathname}`);
