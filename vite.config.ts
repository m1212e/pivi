import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// Works around a bug in the current @sveltejs/kit "next" prerelease: its
	// verbose build logger calls Node's `styleText('grey', ...)`, but Node
	// only recognizes the American spelling 'gray', which crashes `vite build`
	// (see @sveltejs/kit's `log.minor`, only wired up when logLevel is 'info').
	logLevel: 'warn',
	// See src/api/lib-address-shim.ts — @m1212e/rumble's `lib-address`
	// dependency doesn't load under Vite's SSR module runner.
	resolve: {
		alias: {
			'lib-address': fileURLToPath(new URL('./src/api/lib-address-shim.ts', import.meta.url))
		}
	},
	// clientCreator (see src/api/handlers/register.ts) rewrites the generated
	// rumble client on every dev-server request that touches the GraphQL
	// schema. Since that output lives inside the watched src/ tree, an
	// unignored watcher treats its own write as a source change mid-request
	// and triggers a full SSR reload — which re-registers Pothos plugins onto
	// a schema builder that already has them, crashing.
	server: { watch: { ignored: ['**/src/lib/api/rumbleClient/**'] } },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: { remoteFunctions: true }
		}),

		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
