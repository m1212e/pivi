// Builds and pushes every app under apps/, for the local registry that
// supplies the suggested-app images (see docker-compose.yaml and
// src/api/apps/suggested.ts): `bun run apps:build-all [registry]`.
//
// Each app directory's manifest.json names the image (`pivi-<id>:<version>`),
// so there's nothing to pass per app: add an app by adding its directory.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_LABEL, appManifestSchema } from '../src/lib/apps/manifest';

const APPS_DIR = 'apps';
const registry = process.argv[2] ?? 'localhost:5055';

const dirs = readdirSync(APPS_DIR).filter((name) => statSync(join(APPS_DIR, name)).isDirectory());
if (dirs.length === 0) {
	console.error(`No app directories found under ${APPS_DIR}/`);
	process.exit(1);
}

for (const name of dirs) {
	const dir = join(APPS_DIR, name);
	const parsed = appManifestSchema.safeParse(
		JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
	);
	if (!parsed.success) {
		console.error(`${dir}/manifest.json is not a valid app manifest:`);
		for (const issue of parsed.error.issues) {
			console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
		}
		process.exit(1);
	}

	const tag = `${registry}/pivi-${parsed.data.id}:${parsed.data.version}`;
	console.log(`\n=== ${dir} -> ${tag} ===`);

	// The manifest as the schema understands it (defaults applied), on one line.
	const label = JSON.stringify(parsed.data);
	const build = spawnSync(
		'docker',
		[
			'build',
			'-f',
			join(dir, 'Dockerfile'),
			'--label',
			`${MANIFEST_LABEL}=${label}`,
			'-t',
			tag,
			'.'
		],
		{ stdio: 'inherit' }
	);
	if (build.status !== 0) process.exit(build.status ?? 1);

	const push = spawnSync('docker', ['push', tag], { stdio: 'inherit' });
	if (push.status !== 0) process.exit(push.status ?? 1);
}
