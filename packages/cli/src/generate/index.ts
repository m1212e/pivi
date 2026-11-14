import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extraFiles } from './extras';
import type { InitOptions } from './options';
import { projectFiles } from './project';

export * from './options';

/** Every file of a new app, by relative path. */
export function generateProject(options: InitOptions): Record<string, string> {
	return { ...projectFiles(options), ...extraFiles(options) };
}

export function writeProject(dir: string, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
}
