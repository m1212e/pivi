/**
 * How every app icon reaches the screen (AppIcon, the apps panel, the phone's
 * app shortcuts), as an <img> source so the SVG can't run script. Percent
 * encoding instead of base64 because it needs no Buffer on the client.
 */
export function appIconDataUrl(icon: string): string {
	return `data:image/svg+xml,${encodeURIComponent(icon)}`;
}
