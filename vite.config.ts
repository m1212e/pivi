import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

// The variable's own name doubles as the prefix, so this pulls in that one key
// rather than the whole environment (`loadEnv`'s default prefix is `VITE_`).
function allowedHostsFrom(mode: string): string[] {
	const hostname = loadEnv(mode, process.cwd(), 'QR_BIND_HOSTNAME').QR_BIND_HOSTNAME;
	return hostname ? [hostname] : [];
}

// `QR_BIND_HOSTNAME` (see src/env.ts) is the hostname the pairing QR code
// points a phone at, so the dev server has to accept it as a Host header too
// — Vite rejects any host that isn't localhost, a `.localhost` subdomain, or
// a bare IP. Read via `loadEnv` rather than `process.env`: it lives in `.env`,
// which Vite parses itself without ever exporting non-`VITE_` keys to the
// process. That's also why this config is a function — `loadEnv` needs the
// mode, and only the function form receives it.
export default defineConfig(({ mode }) => ({
	// Works around a bug in the current @sveltejs/kit "next" prerelease: its
	// verbose build logger calls Node's `styleText('grey', ...)`, but Node
	// only recognizes the American spelling 'gray', which crashes `vite build`
	// (see @sveltejs/kit's `log.minor`, only wired up when logLevel is 'info').
	logLevel: 'warn',
	resolve: {
		alias: {
			// See src/api/lib-address-shim.ts — @m1212e/rumble's `lib-address`
			// dependency doesn't load under Vite's SSR module runner.
			'lib-address': fileURLToPath(new URL('./src/api/lib-address-shim.ts', import.meta.url))
		}
	},
	// clientCreator (see src/api/handlers/register.ts) rewrites the generated
	// rumble client on every dev-server request that touches the GraphQL
	// schema. Since that output lives inside the watched src/ tree, an
	// unignored watcher treats its own write as a source change mid-request
	// and triggers a full SSR reload — which re-registers Pothos plugins onto
	// a schema builder that already has them, crashing.
	server: {
		allowedHosts: allowedHostsFrom(mode),
		watch: { ignored: ['**/src/lib/api/rumbleClient/**'] }
	},
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
}));
