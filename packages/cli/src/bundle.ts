// Bundles an app into the single JavaScript file its image runs: main.ts, the
// SDK and every dependency, as one ESM file for Node. Built with tsdown, so what
// `pivi-app dev` runs and what pivi runs come out of the same build.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'tsdown';

/** The Node major the images run (see DEFAULT_BASE), which the bundle is compiled for. */
const NODE_TARGET = 'node26';

// CommonJS dependencies (vscode-jsonrpc, for one) `require` Node built-ins. In an
// ESM bundle that only works with a real `require`, which this provides.
const REQUIRE_SHIM =
	"import { createRequire as __piviCreateRequire } from 'node:module';\n" +
	'globalThis.require ??= __piviCreateRequire(import.meta.url);\n';

export type BundleOptions = {
	entry?: string;
	/** Extra export conditions, e.g. `pivi-source` inside the pivi repository. */
	conditions?: string[];
};

/** Writes the bundle as `<outDir>/main.mjs` and returns its path. */
export async function bundleTo(
	dir: string,
	outDir: string,
	options: BundleOptions = {}
): Promise<string> {
	const root = resolve(dir);
	await build({
		config: false,
		cwd: root,
		entry: { main: join(root, options.entry ?? 'main.ts') },
		outDir,
		format: 'esm',
		platform: 'node',
		target: NODE_TARGET,
		outExtensions: () => ({ js: '.mjs' }),
		// Everything goes into the one file: the image has no node_modules.
		deps: { alwaysBundle: [/./] },
		banner: { js: REQUIRE_SHIM },
		shims: true,
		dts: false,
		sourcemap: false,
		clean: true,
		report: false,
		publint: false,
		exports: false,
		logLevel: 'warn',
		inputOptions: {
			resolve: {
				conditionNames: [...(options.conditions ?? []), 'node', 'import', 'module', 'default']
			}
		}
	});
	return join(outDir, 'main.mjs');
}

/** The bundle as bytes, for the image layer. */
export async function bundleApp(dir: string, options: BundleOptions = {}): Promise<Buffer> {
	const out = mkdtempSync(join(tmpdir(), 'pivi-bundle-'));
	try {
		return readFileSync(await bundleTo(dir, out, options));
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}
