// Writes schema/protocol.schema.json, the host/app protocol as JSON Schema,
// so it ships inside the package for apps in other languages and for AI tools.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildProtocolDocument } from '../src/schema';

mkdirSync(new URL('../schema/', import.meta.url), { recursive: true });
writeFileSync(
	new URL('../schema/protocol.schema.json', import.meta.url),
	JSON.stringify(buildProtocolDocument(), null, '\t') + '\n'
);
