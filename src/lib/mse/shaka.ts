// Shared by the engine's MSE path (dualTrackPlayer.ts) and its HLS path
// (hlsPlayer.ts), so Shaka is loaded and polyfilled once.
let shakaPromise: Promise<typeof import('shaka-player')> | undefined;
let polyfillsInstalled = false;

// Lazy because Shaka is large and browser only, a static import would pull it
// into the SSR bundle. `.default` because the package's types export the whole `shaka` namespace
// as a single default export, so Player and polyfill live there.
export async function loadShaka() {
	if (!shakaPromise) shakaPromise = import('shaka-player');
	const shaka = (await shakaPromise).default;
	if (!polyfillsInstalled) {
		shaka.polyfill.installAll();
		polyfillsInstalled = true;
	}
	return shaka;
}
