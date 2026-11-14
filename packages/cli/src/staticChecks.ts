import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { domainsAllow, type AppManifest } from '@pivi/sdk/manifest';
import { SUPPORTED_PROTOCOLS, PROTOCOL_VERSION } from '@pivi/sdk/protocol';
import { readManifest } from './project';

export type Finding = { level: 'error' | 'warning'; message: string };

const SKIP_DIRS = new Set(['node_modules', '.git', '.pivi-dev', 'dist', 'build', '.github']);
const MAX_FILES = 500;

/** The app's own TypeScript, without tests, as [relative path, source]. */
function readSources(dir: string): [string, string][] {
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

const error = (message: string): Finding => ({ level: 'error', message });
const warning = (message: string): Finding => ({ level: 'warning', message });

/** The files a buildable app needs. */
function checkFiles(root: string, entry: string, manifest: AppManifest): Finding[] {
	const findings: Finding[] = [];
	if (!SUPPORTED_PROTOCOLS.includes(manifest.protocol)) {
		findings.push(
			error(
				`manifest.json: protocol ${manifest.protocol} is not supported, this SDK speaks ${PROTOCOL_VERSION}`
			)
		);
	}
	if (!existsSync(join(root, entry))) findings.push(error(`entry file ${entry} not found`));
	if (!existsSync(join(root, 'Dockerfile'))) {
		findings.push(warning('no Dockerfile: the app cannot be built into an image'));
	}
	// The build context may be a parent directory (a monorepo), so look upwards a little.
	const ignoreFiles = [root, resolve(root, '..'), resolve(root, '../..')]
		.map((d) => join(d, '.dockerignore'))
		.filter((f) => existsSync(f));
	if (!ignoreFiles.some((f) => /node_modules/.test(readFileSync(f, 'utf8')))) {
		findings.push(
			warning('.dockerignore should list node_modules so local installs do not leak into the image')
		);
	}
	return findings;
}

/** Declared features without code, and code for features the host would drop. */
function checkFeatures(manifest: AppManifest, source: string): Finding[] {
	return Object.entries(IMPLEMENTS).flatMap(([feature, pattern]) => {
		const declared = manifest.features.includes(feature as never);
		const used = pattern.test(source);
		if (declared && !used)
			return [warning(`feature "${feature}" is declared but no code for it was found`)];
		if (!declared && used) {
			return [
				warning(
					`code for "${feature}" was found but the manifest does not declare it, the host would drop it`
				)
			];
		}
		return [];
	});
}

/** Habits that break in the sandbox. */
function checkHabits(source: string): Finding[] {
	const findings: Finding[] = [];
	if (/process\.stdout\.write|Bun\.stdout/.test(source)) {
		findings.push(
			warning('writing to stdout corrupts the protocol channel, log to stderr instead')
		);
	}
	if (/['"`]\/(storage|cache)(\/|['"`])/.test(source)) {
		findings.push(
			warning(
				"'/storage' or '/cache' is written by hand: use storagePath() / cachePath() from @pivi/sdk/storage, which also work under pivi-app dev"
			)
		);
	}
	return findings;
}

/** Hosts spelled out as URLs in the code that the manifest would not let through. */
function checkHosts(manifest: AppManifest, sources: [string, string][]): Finding[] {
	const allows = (host: string) =>
		manifest.permissions.includes('network') &&
		!!manifest.network &&
		domainsAllow(manifest.network.domains, host);
	const reported = new Set<string>();
	const findings: Finding[] = [];
	for (const [file, text] of sources) {
		for (const [, host] of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
			const name = host!.toLowerCase();
			if (reported.has(`${file}:${name}`) || allows(name)) continue;
			reported.add(`${file}:${name}`);
			findings.push(
				warning(
					`${file} mentions ${name}, which network.domains does not allow (ignore if it is only a comment)`
				)
			);
		}
	}
	return findings;
}

/**
 * Everything that can be checked without running the app. Errors make an image
 * the host refuses or an app that can't work, warnings are likely mistakes.
 */
export function checkProject(dir: string, entry = 'main.ts'): Finding[] {
	const root = resolve(dir);
	const result = readManifest(root);
	if (!result.ok) return result.errors.map((e) => error(`manifest.json: ${e}`));
	const { manifest } = result;
	const sources = readSources(root);
	const source = sources.map(([, text]) => text).join('\n');
	return [
		...checkFiles(root, entry, manifest),
		...checkFeatures(manifest, source),
		...checkHabits(source),
		...checkHosts(manifest, sources)
	];
}
