// The engine's HLS path: Shaka plays the session's playlist through the
// stream-hls proxy (src/routes/api/stream-hls), which rewrote every variant
// and segment URI to point back at itself. Shaka handles what makes HLS
// different from the MSE path's static files: live playlists that keep
// growing, starting at the live edge, and transmuxing MPEG-TS segments.
//
// Quality is a cap rather than a reload: the playlist already lists every
// variant, so a switch just picks another one and Shaka moves over at the
// next segment.
import { loadShaka } from './shaka';

/** Kept by the engine to seek, switch quality, tear down, and read stats. */
export type HlsHandle = {
	seek(seconds: number): void;
	/** Picks the best variant at or below `height`, or lets Shaka adapt when undefined. */
	setMaxHeight(height: number | undefined): void;
	/** Seconds behind the live edge, null for a stream that isn't live. */
	liveLatency(): number | null;
	goToLive(): void;
	destroy(): Promise<void>;
	getStats(): unknown;
};

type Shaka = Awaited<ReturnType<typeof loadShaka>>;
type ShakaPlayer = InstanceType<Shaka['Player']>;

// Several variants can share a height (60 fps and 30 fps), the highest
// bandwidth one wins. Below the lowest variant the lowest one plays.
function variantFor(player: ShakaPlayer, height: number) {
	const variants = player
		.getVariantTracks()
		.filter((track) => track.height != null)
		.sort((a, b) => b.height! - a.height! || b.bandwidth - a.bandwidth);
	return variants.find((track) => track.height! <= height) ?? variants.at(-1);
}

function applyMaxHeight(player: ShakaPlayer, height: number | undefined, switching: boolean) {
	player.configure('abr.enabled', height === undefined);
	if (height === undefined) return;
	const variant = variantFor(player, height);
	// Clearing the buffer on a switch makes it show within a couple of
	// seconds instead of after everything already buffered played out.
	if (variant && !variant.active) player.selectVariantTrack(variant, switching, 2);
}

/**
 * Plays `playlistUrl` in `videoEl` through Shaka. Rejects when the browser
 * can't, there is no fallback for HLS, so the caller shows its error screen.
 */
export async function attachHlsSource(
	videoEl: HTMLVideoElement,
	playlistUrl: string,
	maxHeight: number | undefined,
	onError: (err: unknown) => void = () => {}
): Promise<HlsHandle> {
	const shaka = await loadShaka();
	if (!shaka.Player.isBrowserSupported()) {
		throw new Error('Shaka Player is not supported in this browser');
	}

	const player = new shaka.Player();
	player.addEventListener('error', ((event: CustomEvent) =>
		onError(event.detail)) as EventListener);
	await player.attach(videoEl);
	player.configure('abr.enabled', maxHeight === undefined);
	// The URL ends in .m3u8, but saying so spares Shaka a request to sniff it.
	await player.load(playlistUrl, undefined, 'application/x-mpegurl');
	applyMaxHeight(player, maxHeight, false);

	return {
		seek(seconds) {
			const { start, end } = player.seekRange();
			videoEl.currentTime = Math.max(start, Math.min(end, seconds));
		},
		setMaxHeight: (height) => applyMaxHeight(player, height, true),
		// The seek range ends where Shaka plays a live stream from (the edge
		// minus its safety delay), so playing from there counts as 0 behind.
		liveLatency: () =>
			player.isLive() ? Math.max(0, player.seekRange().end - videoEl.currentTime) : null,
		goToLive: () => {
			player.goToLive();
			videoEl.play().catch(() => {});
		},
		destroy: () => player.destroy(),
		getStats: () => player.getStats()
	};
}
