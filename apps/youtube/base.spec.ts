import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI builds base/Dockerfile under the tag package.json's pivi.base names, and the
// app is published on that tag. Bumping yt-dlp or Node in the Dockerfile without
// the tag would publish the app on the old base.
describe('the YouTube base image', () => {
	const dockerfile = readFileSync(new URL('./base/Dockerfile', import.meta.url), 'utf8');
	const { pivi } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

	it('is tagged with the yt-dlp version and Node major it is built with', () => {
		const ytdlp = dockerfile.match(/^ARG YTDLP_VERSION=(\S+)$/m)?.[1];
		const node = dockerfile.match(/^FROM node:(\d+)-alpine$/m)?.[1];
		expect(ytdlp).toBeDefined();
		expect(node).toBeDefined();
		expect(pivi.base).toMatch(
			new RegExp(`/pivi-youtube-base:${ytdlp!.replace(/\./g, '\\.')}-node${node}$`)
		);
	});
});
