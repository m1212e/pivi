// Writes the app protocol's JSON Schema, generated from the zod schemas in
// packages/sdk, for apps written in other languages (attached to each release
// by .github/workflows/protocol.yml):
//
//   bun run apps:protocol [output path]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildProtocolDocument } from '@pivi/sdk/schema';

const target = resolve(process.argv[2] ?? 'build/app-protocol.schema.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildProtocolDocument(), null, '\t')}\n`);
console.log(`Wrote ${target}`);
