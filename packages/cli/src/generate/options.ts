import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID_PATTERN, featureSchema, type Feature } from '@pivi/sdk/manifest';

/** This CLI's package.json, found from src/ in the repo or from dist/ once published. */
function ownPackage(): { version: string; peerDependencies: Record<string, string> } {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 4; i++) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
			if (pkg.name === '@pivi/cli') return pkg;
		} catch {
			// keep looking upwards
		}
		dir = dirname(dir);
	}
	throw new Error('could not find the @pivi/cli package.json');
}

/** What a new app depends on: the SDK range this CLI supports, and this CLI's own version. */
function defaultSpecs() {
	const pkg = ownPackage();
	return { sdk: pkg.peerDependencies['@pivi/sdk']!, cli: `^${pkg.version}` };
}

/** The SDK's own peer dependencies (zod, vscode-jsonrpc), which a new app installs next to it. */
export function sdkPeerDependencies(): Record<string, string> {
	const sdk = createRequire(import.meta.url)('@pivi/sdk/package.json') as {
		peerDependencies: Record<string, string>;
	};
	return sdk.peerDependencies;
}

export const CI_PLATFORMS = ['github', 'gitlab', 'gitea', 'none'] as const;
export type CiPlatform = (typeof CI_PLATFORMS)[number];
export const AGENT_FILES = ['claude', 'agents', 'none'] as const;
export type AgentFiles = (typeof AGENT_FILES)[number];

export type InitOptions = {
	id: string;
	name: string;
	description: string;
	features: Feature[];
	/** Hosts the app needs, `*.suffix` allowed. */
	domains: string[];
	/** Keep state across restarts (adds the `storage` permission and a helper). */
	storage: boolean;
	ci: CiPlatform;
	agent: AgentFiles;
	/** What the generated package.json depends on, e.g. a version range or `file:../pivi/packages/sdk`. */
	sdkSpec: string;
	cliSpec: string;
};

export const FEATURES = featureSchema.options;
/** What a new app implements unless told otherwise. */
export const DEFAULT_FEATURES: readonly Feature[] = ['dashboard', 'screen', 'playback'];

export const titleCase = (id: string) =>
	id
		.split('-')
		.filter(Boolean)
		.map((w) => w[0]!.toUpperCase() + w.slice(1))
		.join(' ');

/** Fills in defaults and refuses what the manifest schema would. */
export function normalizeOptions(partial: Partial<InitOptions> & { id: string }): InitOptions {
	if (!APP_ID_PATTERN.test(partial.id)) {
		throw new Error(`Invalid id "${partial.id}": lowercase letters, digits and dashes only`);
	}
	const features = partial.features ?? [...DEFAULT_FEATURES];
	for (const f of features) {
		if (!FEATURES.includes(f))
			throw new Error(`Unknown feature "${f}". Choose from ${FEATURES.join(', ')}`);
	}
	return {
		id: partial.id,
		name: partial.name ?? titleCase(partial.id),
		description: partial.description ?? `Watch ${titleCase(partial.id)} on pivi`,
		features,
		// The generated app has to validate, and network needs at least one domain.
		domains: partial.domains?.length ? partial.domains : ['example.com'],
		storage: partial.storage ?? false,
		ci: partial.ci ?? 'github',
		agent: partial.agent ?? 'claude',
		sdkSpec: partial.sdkSpec ?? defaultSpecs().sdk,
		cliSpec: partial.cliSpec ?? defaultSpecs().cli
	};
}
