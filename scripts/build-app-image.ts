// Builds an app image: `bun run app:build <app dir> <image tag>`.
//
// The one thing a plain `docker build` can't do is attach the manifest, and the
// manifest has to be exactly right (the host refuses an image whose label
// doesn't validate), so this reads <dir>/manifest.json, validates it with the
// same schema the host uses, and passes it as the dev.pivi.manifest label.
// Run from the repository root; the Dockerfile in <dir> is built with the
// repository as its context.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_LABEL, appManifestSchema } from '../src/lib/apps/manifest';

const [dir, tag] = process.argv.slice(2);
if (!dir || !tag) {
	console.error('Usage: bun run app:build <app dir> <image tag>');
	process.exit(2);
}

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

// The manifest as the schema understands it (defaults applied), on one line.
const label = JSON.stringify(parsed.data);
const result = spawnSync(
	'docker',
	['build', '-f', join(dir, 'Dockerfile'), '--label', `${MANIFEST_LABEL}=${label}`, '-t', tag, '.'],
	{ stdio: 'inherit' }
);
process.exit(result.status ?? 1);
