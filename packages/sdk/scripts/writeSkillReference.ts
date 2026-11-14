import { writeFileSync } from 'node:fs';
import { renderProtocolReference } from './skillReference';

writeFileSync(
	new URL('../skills/pivi-app/references/protocol.md', import.meta.url),
	renderProtocolReference()
);
