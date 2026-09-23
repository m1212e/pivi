// A plugin's static declaration of what it is and what it's allowed to
// touch. The host reads this once, at install/update time, before ever
// starting the plugin's process — capability grants are a build-time
// decision, not something a plugin can negotiate for at runtime.
import { z } from 'zod';

// No filesystem capability exists at all — a plugin has no legitimate need
// to read/write arbitrary paths. State/config goes through
// credential-storage or the dashboard/session contracts instead.
const pluginCapabilitySchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('network'), domains: z.array(z.string()) }),
	z.object({ type: z.literal('credential-storage') }),
	// Materially bigger trust decisions than the above — a plugin's process
	// gets its own display plane or raw controller input for the life of a
	// session (see session.ts). Worth surfacing differently to the user at
	// install time than a plain network grant.
	z.object({ type: z.literal('display-exclusive') }),
	z.object({
		type: z.literal('input-passthrough'),
		devices: z.array(z.enum(['gamepad', 'keyboard']))
	})
]);

export const pluginManifestSchema = z.object({
	id: z.string(),
	name: z.string(),
	version: z.string(),
	// Git remote the plugin was installed from and the ref it's pinned to —
	// what an auto-update check pulls a new commit/tag against.
	source: z.object({ repo: z.string(), ref: z.string() }),
	// What the host will actually grant, not just what the plugin asks for.
	capabilities: z.array(pluginCapabilitySchema),
	// Which UI tiers this plugin uses, so the host knows what to expect back
	// over the RPC channel (dashboard.ts / ui.ts / session.ts).
	uiTiers: z.array(z.enum(['dashboard', 'screen', 'session']))
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
