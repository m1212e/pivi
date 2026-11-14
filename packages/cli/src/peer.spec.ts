import { readFileSync } from 'node:fs';
import semver from 'semver';
import { expect, it } from 'vitest';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

// The CLI validates apps with the SDK they install, so the published peer range has to cover
// the SDK in this repository. Bump it here whenever the SDK gets a new minor (0.x) or major.
it('the @pivi/sdk peer range covers the SDK in this repository', () => {
	const range: string = read('../package.json').peerDependencies['@pivi/sdk'];
	const { version } = read('../../sdk/package.json');
	expect(semver.satisfies(version, range), `${version} is outside ${range}`).toBe(true);
});
