import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pluginManifestSchema } from '#lib/plugins/manifest';

// The manifest ships as an image label and the host refuses an image whose label
// doesn't validate, so a typo here is an uninstallable plugin.
describe('the YouTube plugin manifest', () => {
	const manifest = pluginManifestSchema.parse(
		JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
	);

	it('validates against the schema the host uses', () => {
		expect(manifest.id).toBe('youtube');
	});

	it('declares what the plugin actually does', () => {
		expect(manifest.features).toEqual(
			expect.arrayContaining(['dashboard', 'screen', 'playback', 'skipSegments', 'auth'])
		);
		expect(manifest.entryScreenId).toBe('browse');
	});
});
