import { featureSchema, type Feature } from '@pivi/sdk/manifest';

export type CiPlatform = 'github' | 'none';
export type AgentFiles = 'claude' | 'agents' | 'none';

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
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const titleCase = (id: string) =>
	id
		.split('-')
		.filter(Boolean)
		.map((w) => w[0]!.toUpperCase() + w.slice(1))
		.join(' ');

/** Fills in defaults and refuses what the manifest schema would. */
export function normalizeOptions(partial: Partial<InitOptions> & { id: string }): InitOptions {
	if (!ID_PATTERN.test(partial.id)) {
		throw new Error(`Invalid id "${partial.id}": lowercase letters, digits and dashes only`);
	}
	const features = partial.features ?? ['dashboard', 'screen', 'playback'];
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
		sdkSpec: partial.sdkSpec ?? '^0.1.0',
		cliSpec: partial.cliSpec ?? '^0.1.0'
	};
}
