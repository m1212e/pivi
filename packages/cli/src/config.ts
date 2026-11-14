// Per-app settings for pivi-app, from the optional `pivi` section of the app's
// package.json, so a project's build is reproducible without flags:
//
//   "pivi": {
//     "base": "ghcr.io/me/my-base:1",            image to build on (default node:26-alpine)
//     "platforms": ["linux/amd64", "linux/arm64"],
//     "entry": "main.ts",
//     "conditions": ["pivi-source"]               export conditions for bundling
//   }
//
// Command line flags win over these.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type AppConfig = {
	base?: string;
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
		base: string(section.base, 'base'),
		platforms: strings(section.platforms, 'platforms'),
		entry: string(section.entry, 'entry'),
		conditions: strings(section.conditions, 'conditions')
	};
}
