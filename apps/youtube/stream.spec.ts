import { describe, expect, it } from 'vitest';
import { resolveFromInfo, type YtDlpInfo } from './stream';

const live: YtDlpInfo = {
	title: 'Live now',
	duration: 0,
	is_live: true,
	url: 'https://manifest.googlevideo.com/variant.m3u8',
	manifest_url: 'https://manifest.googlevideo.com/master.m3u8',
	vcodec: 'avc1.64001F',
	acodec: 'mp4a.40.2',
	ext: 'mp4',
	formats: [
		{ height: 1080, vcodec: 'avc1' },
		{ height: 720, vcodec: 'avc1' }
	]
};

describe('resolveFromInfo for a livestream', () => {
	it('plays the master playlist as live HLS without seeking', () => {
		const stream = resolveFromInfo('abc', live);
		expect(stream).toMatchObject({
			videoUrl: 'https://manifest.googlevideo.com/master.m3u8',
			videoContainer: 'hls',
			live: true,
			duration: 0,
			qualities: [1080, 720],
			controls: { seek: false, seekButtons: false }
		});
		expect(stream.audioUrl).toBeUndefined();
	});

	it('falls back to the chosen variant when there is no master playlist', () => {
		const stream = resolveFromInfo('abc', { ...live, manifest_url: undefined });
		expect(stream.videoUrl).toBe('https://manifest.googlevideo.com/variant.m3u8');
	});

	it('finds the master playlist on the requested or listed formats', () => {
		const pair = {
			...live,
			url: undefined,
			manifest_url: undefined,
			requested_formats: [
				{
					url: 'https://v/video.m3u8',
					ext: 'mp4',
					manifest_url: 'https://manifest.googlevideo.com/master.m3u8'
				},
				{ url: 'https://v/audio.m3u8', ext: 'm4a' }
			]
		};
		expect(resolveFromInfo('abc', pair).videoUrl).toBe(
			'https://manifest.googlevideo.com/master.m3u8'
		);
		const listed = {
			...live,
			url: undefined,
			manifest_url: undefined,
			formats: [{ height: 720, vcodec: 'avc1', manifest_url: 'https://m/master.m3u8' }]
		};
		expect(resolveFromInfo('abc', listed).videoUrl).toBe('https://m/master.m3u8');
	});

	it('still treats a finished video as a normal one', () => {
		const stream = resolveFromInfo('abc', {
			...live,
			is_live: false,
			duration: 120,
			url: 'https://rr1.googlevideo.com/v.mp4'
		});
		expect(stream.live).toBeUndefined();
		expect(stream.videoContainer).toBe('mp4');
	});
});
