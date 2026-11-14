import { defineConfig } from 'tsdown';

// `cli` is the executable (the package's `bin`), `index` the library the harness is exposed
// through. `exports: { devExports }` adds a `pivi-source` condition for use inside the pivi repo.
export default defineConfig({
	entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node20',
	clean: true,
	sourcemap: true,
	dts: true,
	exports: { devExports: 'pivi-source', bin: false },
	publint: true
});
