import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProtocolDocument } from './protocolSchema';

describe('the published plugin protocol', () => {
	it('matches the generated JSON Schema document (run `bun run plugins:protocol` to refresh it)', () => {
		const committed = JSON.parse(
			readFileSync(new URL('../../../docs/plugin-protocol.schema.json', import.meta.url), 'utf8')
		);
		expect(committed).toEqual(JSON.parse(JSON.stringify(buildProtocolDocument())));
	});

	it('gates every feature-dependent method on a declared feature', () => {
		const { methods, features } = buildProtocolDocument();
		for (const method of methods) {
			if (method.feature) expect(features).toContain(method.feature);
		}
		expect(methods.map((m) => m.method)).toContain('plugin/ready');
	});
});
