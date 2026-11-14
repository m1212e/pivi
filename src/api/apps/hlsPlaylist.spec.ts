import { describe, expect, it } from 'vitest';
import { hlsLinkBuilder, isPlaylist, rewritePlaylist, verifyHlsSignature } from './hlsPlaylist';

const link = (url: string) => `P(${url})`;

describe('rewritePlaylist', () => {
	it('proxies variant URIs of a master playlist and keeps the tags', () => {
		const master = [
			'#EXTM3U',
			'#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60"',
			'#EXT-X-STREAM-INF:BANDWIDTH=3422999,RESOLUTION=1280x720',
			'https://cdn.example.com/v1/playlist/abc.m3u8'
		].join('\n');
		expect(rewritePlaylist(master, 'https://usher.example.com/x.m3u8', link)).toBe(
			[
				'#EXTM3U',
				'#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60"',
				'#EXT-X-STREAM-INF:BANDWIDTH=3422999,RESOLUTION=1280x720',
				'P(https://cdn.example.com/v1/playlist/abc.m3u8)'
			].join('\n')
		);
	});

	it('resolves relative segment and map URIs against the playlist location', () => {
		const media = [
			'#EXTM3U',
			'#EXT-X-MAP:URI="init.mp4"',
			'#EXTINF:2.000,live',
			'seg/1.ts',
			''
		].join('\r\n');
		expect(rewritePlaylist(media, 'https://cdn.example.com/a/index.m3u8', link)).toBe(
			[
				'#EXTM3U',
				'#EXT-X-MAP:URI="P(https://cdn.example.com/a/init.mp4)"',
				'#EXTINF:2.000,live',
				'P(https://cdn.example.com/a/seg/1.ts)',
				''
			].join('\n')
		);
	});

	it('leaves URLs in tags the player never fetches alone', () => {
		const line = '#EXT-X-DATERANGE:ID="ad",X-TV-TWITCH-AD-URL="https://ads.example.com/x"';
		expect(rewritePlaylist(line, 'https://cdn.example.com/a.m3u8', link)).toBe(line);
	});

	it('drops URIs the host could not fetch', () => {
		const media = ['#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"', 'data:text/plain,x'].join('\n');
		expect(rewritePlaylist(media, 'https://cdn.example.com/a.m3u8', link)).toBe('');
	});
});

describe('hlsLinkBuilder', () => {
	it('signs links for exactly their session and URL', () => {
		const upstream = 'https://cdn.example.com/seg/1.ts?token=a&b=c';
		const proxied = new URL(hlsLinkBuilder('twitch', 'chan')(upstream), 'http://localhost');
		expect(proxied.pathname).toBe('/api/stream-hls/twitch/chan/x.ts');
		expect(proxied.searchParams.get('u')).toBe(upstream);
		const signature = proxied.searchParams.get('s')!;
		expect(verifyHlsSignature('twitch', 'chan', upstream, signature)).toBe(true);
		expect(verifyHlsSignature('twitch', 'other', upstream, signature)).toBe(false);
		expect(verifyHlsSignature('twitch', 'chan', `${upstream}x`, signature)).toBe(false);
		expect(verifyHlsSignature('twitch', 'chan', upstream, 'short')).toBe(false);
	});
});

describe('isPlaylist', () => {
	it('goes by content type first, then by extension', () => {
		expect(isPlaylist('application/vnd.apple.mpegurl', 'https://a.example.com/x')).toBe(true);
		expect(isPlaylist('video/mp2t', 'https://a.example.com/x.ts')).toBe(false);
		expect(isPlaylist(null, 'https://a.example.com/x.m3u8?y=1')).toBe(true);
	});
});

describe('rewritePlaylist URI attributes', () => {
	it('does not let a lookalike attribute hide the real URI', () => {
		const line =
			'#EXT-X-KEY:METHOD=AES-128,X-URI="https://a.example/x",URI="https://evil.example/k"';
		const out = rewritePlaylist(line, 'https://c.example/p.m3u8', link);
		expect(out).toContain('URI="P(https://evil.example/k)"');
		expect(out).toContain('X-URI="https://a.example/x"');
	});

	it('drops tags with an unquoted URI instead of passing it through', () => {
		const line = '#EXT-X-MAP:URI=https://evil.example/init.mp4';
		expect(rewritePlaylist(line, 'https://c.example/p.m3u8', link)).toBe('');
	});
});
