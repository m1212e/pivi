// The background an app's tile/badge gets when it hasn't (or hasn't yet, see
// manifest.ts's icon/primaryColor/secondaryColor) declared its own identity —
// shared by every spot an app shows up (AppCard, AppManagerPanel, an app's own
// page) so the same app always gets the same fallback look.
import { profileGradient } from './profileColor';

export function appAccentGradient(
	id: string,
	primaryColor?: string | null,
	secondaryColor?: string | null
): string {
	if (primaryColor)
		return `linear-gradient(135deg, ${primaryColor}, ${secondaryColor ?? primaryColor})`;
	return profileGradient(id);
}

// Sets the `.pivi-aurora` backdrop's three blob colours (see layout.css) to an
// app's own brand colours, for a page shown while that app is running/open --
// so the ambient backdrop reads as "this app" instead of the host's generic
// indigo/fuchsia/cyan. Returns '' (no override, i.e. the generic colours)
// when the app declared no primaryColor, rather than inventing one from
// profileGradient's hash-based palette -- unlike a tile/badge, which always
// needs *some* fill colour, a backdrop tint only makes sense for an app that
// actually chose a brand colour for it.
export function appAuroraStyle(
	primaryColor?: string | null,
	secondaryColor?: string | null
): string {
	if (!primaryColor) return '';
	const secondary = secondaryColor ?? primaryColor;
	return `--pivi-aurora-1: ${primaryColor}; --pivi-aurora-2: ${secondary}; --pivi-aurora-3: ${primaryColor};`;
}
