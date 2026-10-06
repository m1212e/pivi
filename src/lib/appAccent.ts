import { profileGradient } from './profileColor';

/**
 * Fill for an app's icon or badge (AppIcon, AppManagerPanel, the phone's app
 * shortcuts), shared so an app looks the same everywhere. Uses the manifest's
 * brand colors, or a stable hash based gradient for apps without any.
 */
export function appAccentGradient(
	id: string,
	primaryColor?: string | null,
	secondaryColor?: string | null
): string {
	if (primaryColor)
		return `linear-gradient(135deg, ${primaryColor}, ${secondaryColor ?? primaryColor})`;
	return profileGradient(id);
}

/**
 * Tints the `.pivi-aurora` backdrop on an app's page with its brand colors so
 * the page reads as that app. Returns '' without a primaryColor, since unlike a
 * tile a backdrop has no need for a made up color.
 */
export function appAuroraStyle(
	primaryColor?: string | null,
	secondaryColor?: string | null
): string {
	if (!primaryColor) return '';
	const secondary = secondaryColor ?? primaryColor;
	return `--pivi-aurora-1: ${primaryColor}; --pivi-aurora-2: ${secondary}; --pivi-aurora-3: ${primaryColor};`;
}
