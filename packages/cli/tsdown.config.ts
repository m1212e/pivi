import { defineConfig } from 'tsdown';

// `cli` is the executable (the package's `bin`), `index` the library the harness is exposed
// through. `exports: { devExports }` adds a `pivi-source` condition for use inside the pivi repo.
// `preview-client` is the page script `dev --preview` serves, built for the browser; from src/
// the preview server bundles it on the fly instead.
export default defineConfig([
	{
		entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
		format: 'esm',
		platform: 'node',
		target: 'node20',
		clean: true,
		sourcemap: true,
		dts: true,
		exports: { devExports: 'pivi-source', bin: false },
		publint: true
	},
	{
		entry: { 'preview-client': 'src/preview/client.ts' },
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		outExtensions: () => ({ js: '.js' }),
		deps: { alwaysBundle: [/./] },
		dts: false,
		sourcemap: false,
		exports: false,
		publint: false
	}
]);
