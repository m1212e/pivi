import { describe, expect, it } from 'vitest';
import { parseVariants } from './stream';

describe('parseVariants', () => {
	it('reads height and codecs of every variant in a Twitch master playlist', () => {
		const master = [
			'#EXTM3U',
			'#EXT-X-TWITCH-INFO:NODE="x",SERVER-TIME="1.0"',
			'#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES',
			'#EXT-X-STREAM-INF:BANDWIDTH=5996511,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000',
			'https://euc11.playlist.ttvnw.net/v1/playlist/a.m3u8',
			'#EXT-X-STREAM-INF:BANDWIDTH=630000,RESOLUTION=640x360,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="360p30",FRAME-RATE=30.000',
			'https://euc11.playlist.ttvnw.net/v1/playlist/b.m3u8',
			'#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"',
			'https://euc11.playlist.ttvnw.net/v1/playlist/c.m3u8'
		].join('\n');
		expect(parseVariants(master)).toEqual([
			{ height: 1080, codecs: ['avc1.64002A', 'mp4a.40.2'] },
			{ height: 360, codecs: ['avc1.4D401F', 'mp4a.40.2'] }
		]);
	});
});
