// Per-app settings for pivi-app, from the optional `pivi` section of the app's
// package.json, so a project's build is reproducible without flags:
//
//   "pivi": {
//     "platforms": ["linux/amd64", "linux/arm64"],
//     "entry": "main.ts",
//     "conditions": ["pivi-source"]               export conditions for bundling
//   }
//
// The image itself is described by the project's Containerfile. Flags win over these.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type AppConfig = {
	platforms?: string[];
	entry?: string;
	conditions?: string[];
};

const strings = (value: unknown, key: string): string[] | undefined => {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
		throw new Error(`package.json: pivi.${key} must be a list of strings`);
	}
	return value as string[];
};

const string = (value: unknown, key: string): string | undefined => {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw new Error(`package.json: pivi.${key} must be a string`);
	return value;
};

export function readAppConfig(dir: string): AppConfig {
	let pkg: { pivi?: Record<string, unknown> };
	try {
		pkg = JSON.parse(readFileSync(join(resolve(dir), 'package.json'), 'utf8'));
	} catch {
		return {};
	}
	const section = pkg.pivi ?? {};
	return {
		platforms: strings(section.platforms, 'platforms'),
		entry: string(section.entry, 'entry'),
		conditions: strings(section.conditions, 'conditions')
	};
}
