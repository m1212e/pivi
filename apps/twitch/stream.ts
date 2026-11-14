// Resolves a channel login to its live HLS playlist, the same two steps the
// Twitch website takes: a playback access token from GQL, then the master
// playlist from usher with that token. The host proxies the playlist and its
// segments (src/routes/api/stream-hls) and the player picks the variant, so
// the app only reports which heights exist.
import type { ResolvedStream } from '../../sdk/protocol';
import { isSignedIn } from './auth';
import { gql } from './gql';

// Settled answers about the channel, retrying as someone else won't change them.
class ChannelUnavailable extends Error {}

type TokenData = {
	streamPlaybackAccessToken: { value: string; signature: string } | null;
	user: { displayName: string; stream: { title: string | null } | null } | null;
};

async function playbackToken(login: string, anonymous: boolean) {
	const data = await gql<TokenData>(
		`query($login: String!) {
			streamPlaybackAccessToken(channelName: $login, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) {
				value
				signature
			}
			user(login: $login) { displayName stream { title } }
		}`,
		{ login },
		{ anonymous }
	);
	if (!data.user) throw new ChannelUnavailable(`No Twitch channel "${login}"`);
	if (!data.user.stream || !data.streamPlaybackAccessToken) {
		throw new ChannelUnavailable(`${data.user.displayName} is offline`);
	}
	return { token: data.streamPlaybackAccessToken, user: data.user, title: data.user.stream.title };
}

function usherUrl(login: string, token: { value: string; signature: string }): string {
	const params = new URLSearchParams({
		sig: token.signature,
		token: token.value,
		allow_source: 'true',
		allow_audio_only: 'false',
		playlist_include_framerate: 'true',
		// H.264 only. Channels using Twitch's enhanced broadcasting also offer
		// HEVC and AV1 variants, which the Pi can't decode reliably.
		supported_codecs: 'avc1',
		player_backend: 'mediaplayer',
		p: String(Math.floor(Math.random() * 1e7))
	});
	return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8?${params}`;
}

type Variant = { height: number; codecs: string[] };

/** The video variants a master playlist lists, from its EXT-X-STREAM-INF lines. */
export function parseVariants(master: string): Variant[] {
	return master.split(/\r?\n/).flatMap((line) => {
		if (!line.startsWith('#EXT-X-STREAM-INF:')) return [];
		const height = Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1]);
		if (!height) return [];
		const codecs = /CODECS="([^"]*)"/.exec(line)?.[1].split(',') ?? [];
		return [{ height, codecs: codecs.map((codec) => codec.trim()) }];
	});
}

async function fetchMaster(url: string, login: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	// usher answers 404 for a channel that went offline after the token.
	if (response.status === 404) throw new ChannelUnavailable(`${login} is offline`);
	if (!response.ok) throw new Error(`Twitch usher answered ${response.status}`);
	return response.text();
}

async function resolveAs(login: string, anonymous: boolean): Promise<ResolvedStream> {
	const { token, user, title } = await playbackToken(login, anonymous);
	const url = usherUrl(login, token);
	const variants = parseVariants(await fetchMaster(url, login));
	if (variants.length === 0) throw new Error(`No playable variants for ${login}`);
	const codecs = variants[0].codecs;
	return {
		videoUrl: url,
		videoContainer: 'hls',
		vcodec: codecs.find((codec) => codec.startsWith('avc1')) ?? 'avc1',
		acodec: codecs.find((codec) => codec.startsWith('mp4a')),
		title: title ? `${user.displayName}: ${title}` : user.displayName,
		duration: 0,
		live: true,
		qualities: [...new Set(variants.map((variant) => variant.height))],
		controls: { seek: false, seekButtons: false },
		chat: true
	};
}

// Signed in, the token is the account's, which is what lets a subscriber
// watch without ads or see subscriber-only streams. If Twitch won't play it
// that way, the anonymous token still plays everything public.
async function resolveLive(login: string): Promise<ResolvedStream> {
	if (!isSignedIn()) return resolveAs(login, true);
	try {
		return await resolveAs(login, false);
	} catch (err) {
		if (err instanceof ChannelUnavailable) throw err;
		console.error(`[warn] signed-in playback of ${login} failed, retrying anonymously: ${err}`);
		return resolveAs(login, true);
	}
}

// The player asks once per quality tier as it opens, all for the same
// playlist, so one resolution serves them all for a short while.
const REUSE_MS = 60_000;
const recent = new Map<string, { at: number; stream: Promise<ResolvedStream> }>();

export function resolveStream(login: string): Promise<ResolvedStream> {
	const key = login.toLowerCase();
	const hit = recent.get(key);
	if (hit && Date.now() - hit.at < REUSE_MS) return hit.stream;
	for (const [other, entry] of recent) {
		if (Date.now() - entry.at >= REUSE_MS) recent.delete(other);
	}
	const stream = resolveLive(key);
	recent.set(key, { at: Date.now(), stream });
	stream.catch(() => recent.delete(key));
	return stream;
}
