// A plugin's static declaration of what it is, what it implements and what
// it's asking to be allowed to touch. It ships inside the plugin's OCI image
// (see imageRef.ts) so the host can read it, and show it to the user, before
// pulling or running anything — permissions are a install-time decision the
// user makes, not something a plugin can negotiate for at runtime.
//
// A plugin is any OCI image that speaks the host protocol (host.ts) over
// its stdin/stdout, so nothing here assumes a language or runtime.
import { z } from 'zod';

// What the user can switch on or off for a plugin. A fixed enum on purpose:
// every key has to be something the sandbox can actually enforce, so a new
// one is added together with its enforcement, never speculatively.
export const permissionKeySchema = z.enum([
	// Outbound access to exactly the domains in `network.domains`, all of them
	// together. Everything else (other domains, the LAN, localhost, the host
	// itself) stays unreachable.
	'network',
	// Persistent state, mounted at /storage for the plugin's instance. Kept per
	// (plugin, profile) and removed when the plugin is uninstalled. Not encrypted
	// at rest.
	'storage',
	// Disposable state, mounted at /cache. The host may wipe it at any time
	// (updates, low disk, the user asking), so a plugin can't rely on it.
	'cache'
]);
export type PermissionKey = z.infer<typeof permissionKeySchema>;

// What the plugin implements, so the host only ever calls things it declared
// instead of probing and swallowing errors. A plugin picks any subset.
export const featureSchema = z.enum([
	// Publishes home-dashboard cards (Tier 1, see dashboard.ts).
	'dashboard',
	// Publishes a declarative screen (Tier 2, see ui.ts).
	'screen',
	// Resolves a session id to a playable stream (resolveStream).
	'playback',
	// Reports skippable stretches of a stream (resolveSkipSegments).
	'skipSegments',
	// Publishes a sign-in the user completes on another device (auth.ts).
	'auth'
]);
export type Feature = z.infer<typeof featureSchema>;

const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
const DOMAIN_PATTERN = new RegExp(`^(\\*\\.)?${LABEL}(\\.${LABEL})+$`, 'i');

// An exact hostname, or `*.suffix` for the suffix and everything beneath it.
// Never an IP, a port, a path, a bare `*`, or a wildcard over a single-label
// suffix like `*.com`: a domain has to name something the plugin really talks
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

export const pluginManifestSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and dashes only'),
		name: z.string(),
		version: z.string(),
		// Version of the host<->plugin protocol (host.ts) this plugin speaks, so
		// the host can refuse one it can't talk to instead of failing oddly.
		protocol: z.number().int().positive(),
		features: z.array(featureSchema),
		permissions: z.array(permissionKeySchema),
		// Required exactly when the `network` permission is requested.
		network: z.object({ domains: z.array(domainSchema).min(1) }).optional(),
		// The screen the app page opens on. Only meaningful for a plugin that
		// implements the 'screen' feature.
		entryScreenId: z.string().default('main')
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

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

// The OCI image label the manifest is read from (a JSON document).
export const MANIFEST_LABEL = 'dev.pivi.manifest';
