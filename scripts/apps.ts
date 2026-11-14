// App tooling for the apps in this repository, on top of the pivi-app CLI
// (packages/cli), one subcommand per package.json script:
//
//   bun run app:build <app dir>                build one app image (an OCI layout)
//   bun run apps:build-all [registry] [--no-push]
//                                             publish every app under apps/ as
//                                             <registry>/pivi-<id>:<version> and :latest
//   bun run apps:protocol [output path]       write the protocol JSON Schema
//
// Each app's base image and bundling conditions come from the `pivi` section of
// its package.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEV_REGISTRY } from '../src/lib/apps/devRegistry';
import { buildProtocolDocument } from '@pivi/sdk/schema';

const APPS_DIR = 'apps';
const CLI = ['--conditions', 'pivi-source', 'packages/cli/src/cli.ts'];

function fail(message: string, code = 1): never {
	console.error(message);
	process.exit(code);
}

function pivi(...args: string[]) {
	const result = spawnSync('bun', [...CLI, ...args], { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// Each manifest names its image (`pivi-<id>`), so adding an app is just adding
// its directory. `--no-push` only builds, for checking that they still build.
function buildAll(registry = DEV_REGISTRY, push = true) {
	const dirs = readdirSync(APPS_DIR)
		.map((name) => join(APPS_DIR, name))
		.filter((path) => statSync(path).isDirectory());
	if (dirs.length === 0) fail(`No app directories found under ${APPS_DIR}/`);
	for (const dir of dirs) {
		const { id } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
		console.log(`\n=== ${dir} ===`);
		if (push) pivi('publish', dir, `${registry}/pivi-${id}`);
		else pivi('build', dir);
	}
}

function writeProtocol(output = 'build/app-protocol.schema.json') {
	const target = resolve(output);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(buildProtocolDocument(), null, '\t')}\n`);
	console.log(`Wrote ${target}`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
	case 'build-all':
		buildAll(
			args.find((a) => !a.startsWith('--')),
			!args.includes('--no-push')
		);
		break;
	case 'protocol':
		writeProtocol(args[0]);
		break;
	default:
		fail('Usage: bun scripts/apps.ts <build-all|protocol> [args]', 2);
}
