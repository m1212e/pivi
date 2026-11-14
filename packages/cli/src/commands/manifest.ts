import { readManifest } from '../project';

/** The validated manifest on one line: the value of the `dev.pivi.manifest` image label. */
export function manifest(dir: string) {
	const result = readManifest(dir);
	if (!result.ok) {
		console.error(`${result.path} is not a valid app manifest:\n  ${result.errors.join('\n  ')}`);
		return 1;
	}
	console.log(JSON.stringify(result.manifest));
	return 0;
}
