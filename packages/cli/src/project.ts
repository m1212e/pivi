import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appManifestSchema, type AppManifest } from '@pivi/sdk/manifest';

export type ManifestResult =
	{ ok: true; manifest: AppManifest; path: string } | { ok: false; errors: string[]; path: string };

/** Reads and validates `<dir>/manifest.json` with the schema the host uses at install. */
export function readManifest(dir: string): ManifestResult {
	const path = join(resolve(dir), 'manifest.json');
	if (!existsSync(path)) return { ok: false, errors: ['manifest.json not found'], path };
	let json: unknown;
	try {
		json = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		return { ok: false, errors: [`manifest.json is not valid JSON: ${String(error)}`], path };
	}
	const parsed = appManifestSchema.safeParse(json);
	if (parsed.success) return { ok: true, manifest: parsed.data, path };
	return {
		ok: false,
		path,
		errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
	};
}
