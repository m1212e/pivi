// App tooling, one subcommand per package.json script:
//
//   bun run app:build <app dir> <image tag>   build one app image
//   bun run apps:build-all [registry] [--no-push]
//                                             build and push every app under apps/
//   bun scripts/apps.ts manifest <app dir>    print the validated manifest label (CI)
//   bun run apps:protocol [output path]       write the protocol JSON Schema
//
// A plain `docker build` can't attach the manifest, and the host refuses an image
// whose label doesn't validate, so builds read <dir>/manifest.json, validate it
// with the host's schema and pass it as the dev.pivi.manifest label. Run from the
// repository root, the repo is the Docker build context.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEV_REGISTRY } from '../src/lib/apps/devRegistry';
import { MANIFEST_LABEL, appManifestSchema } from '../src/lib/apps/manifest';
import { buildProtocolDocument } from '../src/lib/apps/protocolSchema';

const APPS_DIR = 'apps';

function fail(message: string, code = 1): never {
	console.error(message);
	process.exit(code);
}

function docker(...args: string[]) {
	const result = spawnSync('docker', args, { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function loadManifest(dir: string) {
	const parsed = appManifestSchema.safeParse(
		JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
	);
	if (parsed.success) return parsed.data;
	const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
	return fail([`${dir}/manifest.json is not a valid app manifest:`, ...issues].join('\n'));
}

function buildImage(dir: string, tag: string) {
	// The manifest as the schema understands it (defaults applied), on one line.
	const label = JSON.stringify(loadManifest(dir));
	docker(
		'build',
		'-f',
		join(dir, 'Dockerfile'),
		'--label',
		`${MANIFEST_LABEL}=${label}`,
		'-t',
		tag,
		'.'
	);
}

// Each manifest names its image (`pivi-<id>:<version>`), so adding an app is
// just adding its directory.
// `--no-push` only builds, for CI runs that just check the images still build.
function buildAll(registry = DEV_REGISTRY, push = true) {
	const dirs = readdirSync(APPS_DIR)
		.map((name) => join(APPS_DIR, name))
		.filter((path) => statSync(path).isDirectory());
	if (dirs.length === 0) fail(`No app directories found under ${APPS_DIR}/`);

	for (const dir of dirs) {
		const { id, version } = loadManifest(dir);
		const tag = `${registry}/pivi-${id}:${version}`;
		// `latest` is what an untagged suggested app follows.
		const latest = `${registry}/pivi-${id}:latest`;
		console.log(`\n=== ${dir} -> ${tag} ===`);
		buildImage(dir, tag);
		docker('tag', tag, latest);
		if (push) {
			docker('push', tag);
			docker('push', latest);
		}
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
	case 'build': {
		const [dir, tag] = args;
		if (!dir || !tag) fail('Usage: bun run app:build <app dir> <image tag>', 2);
		buildImage(dir, tag);
		break;
	}
	case 'build-all':
		buildAll(
			args.find((a) => !a.startsWith('--')),
			!args.includes('--no-push')
		);
		break;
	case 'manifest':
		if (!args[0]) fail('Usage: bun scripts/apps.ts manifest <app dir>', 2);
		console.log(JSON.stringify(loadManifest(args[0])));
		break;
	case 'protocol':
		writeProtocol(args[0]);
		break;
	default:
		fail('Usage: bun scripts/apps.ts <build|build-all|manifest|protocol> [args]', 2);
}
