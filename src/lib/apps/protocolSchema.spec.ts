import { describe, expect, it } from 'vitest';
import { buildProtocolDocument } from './protocolSchema';

describe('the app protocol document', () => {
	it('gates every feature-dependent method on a declared feature', () => {
		const { methods, features } = buildProtocolDocument();
		for (const method of methods) {
			if (method.feature) expect(features).toContain(method.feature);
		}
		expect(methods.map((m) => m.method)).toContain('plugin/ready');
	});
});
