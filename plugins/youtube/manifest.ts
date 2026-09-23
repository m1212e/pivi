// A real plugin would live in its own git repo, installed the way
// SKETCH.md's "Plugin distribution" decision describes (point pivi at the
// repo, it clones/updates it). This one lives inside the main repo purely
// so the prototype in main.ts can share the root tsconfig/node_modules
// while the plugin contracts (src/lib/plugins/) are still evolving.
import type { PluginManifest } from '#lib/plugins/manifest';
import { pluginManifestSchema } from '#lib/plugins/manifest';

export const manifest: PluginManifest = pluginManifestSchema.parse({
	id: 'youtube',
	name: 'YouTube',
	version: '0.1.0',
	source: { repo: 'local', ref: 'HEAD' },
	capabilities: [
		// youtubei.js (innertube.ts, tvHomeFeed.ts, tvSearch.ts) talks to
		// youtube.com for sign-in and all browsing/search; sponsorBlock.ts
		// talks to sponsor.ajay.app for skippable-section data. Declared here
		// for documentation even though this prototype doesn't route these
		// libraries' own network calls through the httpRequest capability
		// check.
		{ type: 'network', domains: ['www.youtube.com', 'sponsor.ajay.app'] },
		{ type: 'credential-storage' },
		{ type: 'display-exclusive' }
	],
	uiTiers: ['dashboard', 'screen', 'session']
});
