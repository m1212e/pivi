// An app's static declaration of what it is, implements and wants to access.
// It ships as an image label so the host can show it for approval before
// pulling or running anything, and permissions stay an install-time decision.
import { z } from 'zod';

/**
 * What the user can switch on or off for an app. A fixed enum because every
 * key must be enforced by the sandbox, so a new one lands with its enforcement.
 */
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

/**
 * What the app implements, so the host only calls methods an app declared
 * (protocolSchema.ts gates each method on one) instead of probing for them.
 */
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
	// action is `openOnPhone`, see dashboard.ts's AppAction) and handles the
	// actual login itself.
]);
export type Feature = z.infer<typeof featureSchema>;

const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
const DOMAIN_PATTERN = new RegExp(`^(\\*\\.)?${LABEL}(\\.${LABEL})+$`, 'i');

/**
 * One entry of `network.domains`, which the user approves verbatim and the
 * sandbox enforces. So it must name something real: an exact host or
 * `*.suffix`, never an IP, port, path or overly broad wildcard like `*.com`.
 */
export const domainSchema = z
	.string()
	.regex(DOMAIN_PATTERN, 'Expected a hostname like "example.com" or "*.example.com"')
	.refine((d) => !/^\d+(\.\d+)*$/.test(d.replace(/^\*\./, '')), 'IP addresses are not allowed')
	.refine((d) => !d.startsWith('*.') || d.slice(2).includes('.'), 'Wildcard is too broad');

/**
 * Used by the runtime to reject URLs an app hands back outside its declared
 * domains, and by manifestDiff. A `*.suffix` entry also matches the suffix itself.
 */
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
// the home screen, an app's own page header). The host only ever loads it as
// an image, never inserts it as markup, so a browser won't run script or fetch
// anything from it. This check is defense in depth on top of that, not the
// thing actually keeping it safe.
const appIconSchema = z
	.string()
	.max(MAX_ICON_BYTES, 'Icon is too large')
	.refine((svg) => /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svg), 'Expected an <svg> document')
	.refine((svg) => !/<script[\s>]/i.test(svg), 'Icon must not contain <script>')
	.refine((svg) => !/\son[a-z]+\s*=/i.test(svg), 'Icon must not contain event handler attributes')
	.refine((svg) => !/javascript:/i.test(svg), 'Icon must not contain javascript: URLs');

/**
 * Validates a manifest wherever one enters the system: the registry client
 * reading an image label, and scripts/apps.ts when building app images.
 */
export const appManifestSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and dashes only'),
		name: z.string(),
		version: z.string(),
		// One line saying what the app is, shown where it's offered for install.
		description: z.string().max(140).optional(),
		// Version of the host<->app protocol (protocol.ts) this app speaks, so
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
		// its home-screen tile, its own page header. All optional, an app
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

/** The image label carrying the manifest JSON, written by scripts/apps.ts and read by the registry client. */
export const MANIFEST_LABEL = 'dev.pivi.manifest';
