// An app's static declaration of what it is, what it implements and what
// it's asking to be allowed to touch. It ships inside the app's OCI image
// (see imageRef.ts) so the host can read it, and show it to the user, before
// pulling or running anything — permissions are a install-time decision the
// user makes, not something an app can negotiate for at runtime.
//
// An app is any OCI image that speaks the host protocol (host.ts) over
// its stdin/stdout, so nothing here assumes a language or runtime.
import { z } from 'zod';

// What the user can switch on or off for an app. A fixed enum on purpose:
// every key has to be something the sandbox can actually enforce, so a new
// one is added together with its enforcement, never speculatively.
export const permissionKeySchema = z.enum([
	// Outbound access to exactly the domains in `network.domains`, all of them
	// together. Everything else (other domains, the LAN, localhost, the host
	// itself) stays unreachable.
	'network',
	// Persistent state, mounted at /storage for the app's instance. Kept per
	// (app, profile) and removed when the app is uninstalled. Not encrypted
	// at rest.
	'storage',
	// Disposable state, mounted at /cache. The host may wipe it at any time
	// (updates, low disk, the user asking), so an app can't rely on it.
	'cache'
]);
export type PermissionKey = z.infer<typeof permissionKeySchema>;

// What the app implements, so the host only ever calls things it declared
// instead of probing and swallowing errors. An app picks any subset.
export const featureSchema = z.enum([
	// Publishes home-dashboard cards (Tier 1, see dashboard.ts).
	'dashboard',
	// Publishes a declarative screen (Tier 2, see ui.ts).
	'screen',
	// Resolves a session id to a playable stream (resolveStream).
	'playback',
	// Reports skippable stretches of a stream (resolveSkipSegments).
	'skipSegments'
	// There's no dedicated sign-in feature: an app that needs one shows it
	// as part of its own 'screen' content (a code or link, a button whose
	// action is `openOnPhone` — see dashboard.ts's AppAction) and handles the
	// actual login itself. See apps/youtube/auth.ts for the pattern.
]);
export type Feature = z.infer<typeof featureSchema>;

const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
const DOMAIN_PATTERN = new RegExp(`^(\\*\\.)?${LABEL}(\\.${LABEL})+$`, 'i');

// An exact hostname, or `*.suffix` for the suffix and everything beneath it.
// Never an IP, a port, a path, a bare `*`, or a wildcard over a single-label
// suffix like `*.com`: a domain has to name something the app really talks
// to, and the user is shown this list verbatim.
export const domainSchema = z
	.string()
	.regex(DOMAIN_PATTERN, 'Expected a hostname like "example.com" or "*.example.com"')
	.refine((d) => !/^\d+(\.\d+)*$/.test(d.replace(/^\*\./, '')), 'IP addresses are not allowed')
	.refine((d) => !d.startsWith('*.') || d.slice(2).includes('.'), 'Wildcard is too broad');

// Whether `hostname` falls under one of `domains` (exact, or beneath a
// `*.suffix` entry — the suffix itself counts too).
export function domainsAllow(domains: readonly string[], hostname: string): boolean {
	const host = hostname.toLowerCase();
	return domains.some((entry) => {
		const domain = entry.toLowerCase();
		if (!domain.startsWith('*.')) return host === domain;
		const suffix = domain.slice(2);
		return host === suffix || host.endsWith(`.${suffix}`);
	});
}

// A plain hex color (`#rgb` or `#rrggbb`) rather than any valid CSS color: the
// host applies these as design tokens (see theme.ts's reasoning), not raw CSS,
// so the value has to be something that can't carry anything but a color.
const hexColorSchema = z
	.string()
	.regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Expected a hex color like "#4f46e5"');

const MAX_ICON_BYTES = 16 * 1024;

// The icon is shown in the host's own chrome (install preview, the apps list,
// the home screen, an app's own page header) — never inside the app's sandboxed
// Shadow DOM — so it's rendered as an <img src="data:image/svg+xml,..."> via
// appIconDataUrl() below, never inserted as markup: a browser won't run script
// or fetch anything from an SVG loaded that way. This check is defense in
// depth on top of that, not the thing actually keeping it safe.
const appIconSchema = z
	.string()
	.max(MAX_ICON_BYTES, 'Icon is too large')
	.refine((svg) => /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svg), 'Expected an <svg> document')
	.refine((svg) => !/<script[\s>]/i.test(svg), 'Icon must not contain <script>')
	.refine((svg) => !/\son[a-z]+\s*=/i.test(svg), 'Icon must not contain event handler attributes')
	.refine((svg) => !/javascript:/i.test(svg), 'Icon must not contain javascript: URLs');

// A data URL an <img> can load directly. Percent-encoding rather than base64:
// it needs no Buffer (this runs on the client too) and round-trips unicode
// (an icon's <text>, titles) without extra escaping.
export function appIconDataUrl(icon: string): string {
	return `data:image/svg+xml,${encodeURIComponent(icon)}`;
}

export const appManifestSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and dashes only'),
		name: z.string(),
		version: z.string(),
		// Version of the host<->app protocol (host.ts) this app speaks, so
		// the host can refuse one it can't talk to instead of failing oddly.
		protocol: z.number().int().positive(),
		features: z.array(featureSchema),
		permissions: z.array(permissionKeySchema),
		// Required exactly when the `network` permission is requested.
		network: z.object({ domains: z.array(domainSchema).min(1) }).optional(),
		// The screen the app page opens on. Only meaningful for an app that
		// implements the 'screen' feature.
		entryScreenId: z.string().default('main'),
		// Brand identity shown wherever the app itself (not its dashboard cards
		// or screen content) is represented: the install preview, the apps list,
		// its home-screen tile, its own page header. All optional — an app
		// without them falls back to the host's generic styling.
		icon: appIconSchema.optional(),
		primaryColor: hexColorSchema.optional(),
		secondaryColor: hexColorSchema.optional()
	})
	.superRefine((manifest, ctx) => {
		if (new Set(manifest.permissions).size !== manifest.permissions.length) {
			ctx.addIssue({ code: 'custom', path: ['permissions'], message: 'Duplicate permission' });
		}
		const wantsNetwork = manifest.permissions.includes('network');
		if (wantsNetwork && !manifest.network) {
			ctx.addIssue({
				code: 'custom',
				path: ['network'],
				message: 'The network permission needs the domains it applies to'
			});
		}
		if (!wantsNetwork && manifest.network) {
			ctx.addIssue({
				code: 'custom',
				path: ['network'],
				message: 'Domains were declared without the network permission'
			});
		}
	});

export type AppManifest = z.infer<typeof appManifestSchema>;

// The OCI image label the manifest is read from (a JSON document).
export const MANIFEST_LABEL = 'dev.pivi.manifest';
