import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { domainsAllow } from '@pivi/sdk/manifest';
import { SUPPORTED_PROTOCOLS, PROTOCOL_VERSION } from '@pivi/sdk/protocol';
import { readManifest } from './project';

export type Finding = { level: 'error' | 'warning'; message: string };

const SKIP_DIRS = new Set(['node_modules', '.git', '.pivi-dev', 'dist', 'build', '.github']);
const MAX_FILES = 500;

/** The app's own TypeScript, without tests, as [relative path, source]. */
export function readSources(dir: string): [string, string][] {
	const root = resolve(dir);
	const out: [string, string][] = [];
	const walk = (current: string) => {
		for (const name of readdirSync(current)) {
			if (out.length >= MAX_FILES) return;
			const path = join(current, name);
			if (statSync(path).isDirectory()) {
				if (!SKIP_DIRS.has(name)) walk(path);
			} else if (/\.(ts|mts|js|mjs)$/.test(name) && !/\.(spec|test)\./.test(name)) {
				out.push([relative(root, path), readFileSync(path, 'utf8')]);
			}
		}
	};
	walk(root);
	return out;
}

// feature -> what the source calls when it implements it
const IMPLEMENTS: Record<string, RegExp> = {
	dashboard: /publishDashboard/,
	screen: /publishScreen/,
	playback: /resolveStream/,
	skipSegments: /resolveSkipSegments/,
	chat: /onOpenChat|openChatNotification|sendChat|chatMessagesNotification/
};

/**
 * Everything that can be checked without running the app. Errors make an image
 * the host refuses or an app that can't work, warnings are likely mistakes.
 */
export function checkProject(dir: string, entry = 'main.ts'): Finding[] {
	const root = resolve(dir);
	const findings: Finding[] = [];
	const add = (level: Finding['level'], message: string) => findings.push({ level, message });

	const result = readManifest(root);
	if (!result.ok) {
		for (const error of result.errors) add('error', `manifest.json: ${error}`);
		return findings;
	}
	const { manifest } = result;

	if (!SUPPORTED_PROTOCOLS.includes(manifest.protocol)) {
		add(
			'error',
			`manifest.json: protocol ${manifest.protocol} is not supported, this SDK speaks ${PROTOCOL_VERSION}`
		);
	}
	if (!existsSync(join(root, entry))) add('error', `entry file ${entry} not found`);
	if (!existsSync(join(root, 'Dockerfile'))) {
		add('warning', 'no Dockerfile: the app cannot be built into an image');
	}
	// The build context may be a parent directory (a monorepo), so look upwards a little.
	const ignoreFiles = [root, resolve(root, '..'), resolve(root, '../..')]
		.map((d) => join(d, '.dockerignore'))
		.filter((f) => existsSync(f));
	if (!ignoreFiles.some((f) => /node_modules/.test(readFileSync(f, 'utf8')))) {
		add(
			'warning',
			'.dockerignore should list node_modules so local installs do not leak into the image'
		);
	}

	const sources = readSources(root);
	const all = sources.map(([, text]) => text).join('\n');

	for (const [feature, pattern] of Object.entries(IMPLEMENTS)) {
		const declared = manifest.features.includes(feature as never);
		const used = pattern.test(all);
		if (declared && !used) {
			add('warning', `feature "${feature}" is declared but no code for it was found`);
		} else if (!declared && used) {
			add(
				'warning',
				`code for "${feature}" was found but the manifest does not declare it, the host would drop it`
			);
		}
	}

	if (/process\.stdout\.write|Bun\.stdout/.test(all)) {
		add('warning', 'writing to stdout corrupts the protocol channel, log to stderr instead');
	}

	if (/['"`]\/(storage|cache)(\/|['"`])/.test(all)) {
		add(
			'warning',
			"'/storage' or '/cache' is written by hand: use storagePath() / cachePath() from @pivi/sdk/storage, which also work under pivi-app dev"
		);
	}

	// Hosts spelled out as URLs in the code that the manifest would not let through.
	const seen = new Set<string>();
	for (const [file, text] of sources) {
		for (const [, host] of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
			const name = host.toLowerCase();
			const key = `${file}:${name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const allowed =
				manifest.network && manifest.permissions.includes('network')
					? domainsAllow(manifest.network.domains, name)
					: false;
			if (!allowed) {
				add(
					'warning',
					`${file} mentions ${name}, which network.domains does not allow (ignore if it is only a comment)`
				);
			}
		}
	}
	return findings;
}
