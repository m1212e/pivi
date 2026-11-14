import { defineConfig } from 'tsdown';

// One entry per public subpath. `exports.devExports` adds a `pivi-source`
// condition that points at src/, so the host's Vite dev server, svelte-check
// and `bun build` read the sources and need no build step inside this repo.
// Consumers that don't set the condition (everyone on npm) get dist/.
export default defineConfig({
	entry: {
		index: 'src/index.ts',
		manifest: 'src/manifest.ts',
		protocol: 'src/protocol.ts',
		ui: 'src/ui.ts',
		dashboard: 'src/dashboard.ts',
		icons: 'src/icons.ts',
		limits: 'src/limits.ts',
		schema: 'src/schema.ts',
		rpc: 'src/rpc.ts',
		app: 'src/app.ts'
	},
	format: 'esm',
	platform: 'neutral',
	dts: true,
	clean: true,
	sourcemap: true,
	exports: { devExports: 'pivi-source' },
	publint: true
});
