// Resolves a session to its HLS playlist, the same two steps the Twitch
// website takes: a playback access token from GQL, then the master playlist
// from usher with that token. A session is a channel login for its live
// stream, or `vod-<id>` (see vodSession) for a past video. The host proxies the playlist and its
// segments (src/routes/api/stream-hls) and the player picks the variant, so
// the app only reports which heights exist.
import type { ResolvedStream } from '@pivi/sdk/protocol';
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

type Token = { value: string; signature: string };

function usherParams(token: Token): URLSearchParams {
	return new URLSearchParams({
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
}

function usherUrl(login: string, token: Token): string {
	return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8?${usherParams(token)}`;
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

// Logins are letters, digits and underscores, so a dash never clashes.
const VOD_PREFIX = 'vod-';

/** The session id of a past video, as profile cards link it. */
export function vodSession(videoId: string): string {
	return `${VOD_PREFIX}${videoId}`;
}

type VodTokenData = {
	videoPlaybackAccessToken: Token | null;
	video: {
		title: string | null;
		lengthSeconds: number | null;
		owner: { displayName: string } | null;
	} | null;
};

async function resolveVodAs(id: string, anonymous: boolean): Promise<ResolvedStream> {
	const data = await gql<VodTokenData>(
		`query($id: ID!) {
			videoPlaybackAccessToken(id: $id, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) {
				value
				signature
			}
			video(id: $id) { title lengthSeconds owner { displayName } }
		}`,
		{ id },
		{ anonymous }
	);
	if (!data.video || !data.videoPlaybackAccessToken) {
		throw new ChannelUnavailable(`Twitch video ${id} is gone`);
	}
	const url = `https://usher.ttvnw.net/vod/${encodeURIComponent(id)}.m3u8?${usherParams(data.videoPlaybackAccessToken)}`;
	const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	// usher answers 403 for subscriber-only videos without a subscription.
	if (response.status === 403) throw new Error(`Twitch video ${id} is subscriber-only`);
	if (!response.ok) throw new Error(`Twitch usher answered ${response.status}`);
	const variants = parseVariants(await response.text());
	if (variants.length === 0) throw new Error(`No playable variants for video ${id}`);
	const codecs = variants[0].codecs;
	const owner = data.video.owner?.displayName;
	const title = data.video.title ?? '';
	return {
		videoUrl: url,
		videoContainer: 'hls',
		vcodec: codecs.find((codec) => codec.startsWith('avc1')) ?? 'avc1',
		acodec: codecs.find((codec) => codec.startsWith('mp4a')),
		title: owner ? `${owner}: ${title}` : title,
		duration: data.video.lengthSeconds ?? 0,
		qualities: [...new Set(variants.map((variant) => variant.height))]
	};
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
// The same goes for videos, where it unlocks subscriber-only ones.
async function resolveSession(session: string): Promise<ResolvedStream> {
	const resolve = session.startsWith(VOD_PREFIX)
		? (anonymous: boolean) => resolveVodAs(session.slice(VOD_PREFIX.length), anonymous)
		: (anonymous: boolean) => resolveAs(session, anonymous);
	if (!isSignedIn()) return resolve(true);
	try {
		return await resolve(false);
	} catch (err) {
		if (err instanceof ChannelUnavailable) throw err;
		console.error(`[warn] signed-in playback of ${session} failed, retrying anonymously: ${err}`);
		return resolve(true);
	}
}

// The player asks once per quality tier as it opens, all for the same
// playlist, so one resolution serves them all for a short while.
const REUSE_MS = 60_000;
const recent = new Map<string, { at: number; stream: Promise<ResolvedStream> }>();

export function resolveStream(session: string): Promise<ResolvedStream> {
	const key = session.toLowerCase();
	const hit = recent.get(key);
	if (hit && Date.now() - hit.at < REUSE_MS) return hit.stream;
	for (const [other, entry] of recent) {
		if (Date.now() - entry.at >= REUSE_MS) recent.delete(other);
	}
	const stream = resolveSession(key);
	recent.set(key, { at: Date.now(), stream });
	stream.catch(() => recent.delete(key));
	return stream;
}
