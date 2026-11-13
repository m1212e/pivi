/**
 * An `onerror` handler for an app-supplied image with a declared
 * `fallbackImage` (#sdk/dashboard): swaps to it once, so a missing fallback
 * can't loop. Knows nothing about any source's URLs, the app chose both.
 */
export function swapToFallback(fallback: string | undefined) {
	return (event: Event) => {
		const img = event.currentTarget as HTMLImageElement;
		if (fallback && img.getAttribute('src') !== fallback) img.src = fallback;
	};
}
