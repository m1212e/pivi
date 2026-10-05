import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appManifestSchema } from '#lib/apps/manifest';

// The manifest ships as an image label and the host refuses an image whose label
// doesn't validate, so a typo here is an uninstallable app.
describe('the YouTube app manifest', () => {
	const manifest = appManifestSchema.parse(
		JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
	);

	it('validates against the schema the host uses', () => {
		expect(manifest.id).toBe('youtube');
	});

	it('declares what the app actually does', () => {
		expect(manifest.features).toEqual(
			expect.arrayContaining(['dashboard', 'screen', 'playback', 'skipSegments'])
		);
		expect(manifest.entryScreenId).toBe('browse');
	});
});
