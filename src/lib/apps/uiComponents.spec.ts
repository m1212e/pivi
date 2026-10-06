import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UI_NODE_TYPES } from './ui';

describe('the app UI component reference', () => {
	const doc = readFileSync(new URL('../../../docs/app-ui-components.md', import.meta.url), 'utf8');

	it('describes every node kind an app can send', () => {
		for (const type of UI_NODE_TYPES) {
			expect(doc, `docs/app-ui-components.md has no row for \`${type}\``).toContain(
				`| \`${type}\``
			);
		}
	});

	it('names no node kind that does not exist', () => {
		const rows = [...doc.matchAll(/^\| `(\w+)`/gm)].map((match) => match[1]);
		for (const row of rows) expect(UI_NODE_TYPES as readonly string[]).toContain(row);
	});
});
