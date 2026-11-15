import { containerfile, containerignore } from '../image/containerfile';
import { DEV_DIR } from '../paths';
import { sdkPeerDependencies, type InitOptions } from './options';
import { PROTOCOL_VERSION } from '@pivi/sdk/protocol';

const json = (value: unknown) => `${JSON.stringify(value, null, '\t')}\n`;

function manifestFile(o: InitOptions) {
	const permissions = ['network', ...(o.storage ? ['storage'] : [])];
	return json({
		id: o.id,
		name: o.name,
		version: '0.1.0',
		description: o.description,
		protocol: PROTOCOL_VERSION,
		features: o.features,
		permissions,
		network: { domains: o.domains },
		...(o.features.includes('screen') ? { entryScreenId: 'main' } : {}),
		primaryColor: '#4f46e5',
		secondaryColor: '#18181b'
	});
}

function serviceFile(o: InitOptions) {
	const playback = o.features.includes('playback');
	return `// Everything that talks to ${o.name} lives here, with no protocol code in it, so it can be
// unit tested with recorded responses. main.ts only connects it to pivi.
${playback ? "import type { ResolvedStream } from '@pivi/sdk/protocol';\n" : ''}${o.storage ? "import { readJson, removeFile, storagePath, writeJson } from '@pivi/sdk/storage';\n" : ''}
/** Fetches JSON with a timeout and a useful error. Every host it touches must be in manifest.json's network.domains. */
export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
	const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(\`\${url} answered HTTP \${response.status}\`);
	return response.json();
}
${
	o.storage
		? `
// Persistent state lives in /storage (permission "storage"): per profile, kept across restarts.
// storagePath() also works under \`pivi-app dev\`, which points it at a local folder.
// Keep as little as possible, a sign-in's tokens for example.
type Session = { accessToken: string; refreshToken?: string; expiresAt?: number };
const SESSION_FILE = storagePath('session.json');

export const loadSession = () => readJson<Session>(SESSION_FILE);
export const saveSession = (session: Session) => writeJson(SESSION_FILE, session);
export const clearSession = () => removeFile(SESSION_FILE);
`
		: ''
}${
		playback
			? `
/**
 * Turns a session id (whatever your cards put in \`action: { type: 'session', sessionId }\`)
 * into something the pivi player can play. Resolve lazily, here, not when building cards:
 * stream URLs often expire.
 */
export async function resolveStream(sessionId: string): Promise<ResolvedStream> {
	// TODO: look up \`sessionId\` and return its stream, for example:
	// return {
	// 	videoUrl: 'https://…/master.m3u8',
	// 	vcodec: 'h264',
	// 	videoContainer: 'hls',
	// 	title: 'Title',
	// 	duration: 0,
	// 	live: true
	// };
	throw new Error(\`resolveStream is not implemented yet (session "\${sessionId}")\`);
}
`
			: ''
	}`;
}

function mainFile(o: InitOptions) {
	const has = (f: string) => o.features.includes(f as never);
	const imports = ["import { defineApp } from '@pivi/sdk/app';"];
	if (has('screen')) imports.push("import type { UiNode } from '@pivi/sdk/ui';");
	if (has('playback')) imports.push("import { resolveStream } from './service';");

	const screen = has('screen')
		? `
const SCREEN_ID = 'main';

// A screen is data: a tree of the shell's own nodes. The host renders it and owns focus and the
// remote. Node types are in node_modules/@pivi/sdk/src/ui.ts.
function mainScreen(): UiNode {
	return {
		type: 'container',
		direction: 'column',
		center: true,
		children: [
			{ type: 'text', variant: 'headline', value: '${o.name}' },
			{ type: 'text', variant: 'body', value: 'Replace this screen with your app.' },
			{ type: 'button', label: 'Reload', onSelect: 'reload', size: 'lg' }
		]
	};
}
`
		: '';

	const publish: string[] = [];
	if (has('dashboard')) {
		publish.push(`// Cards for the home screen. Example:
		// { kind: 'suggestion', id: 'a', title: 'Title', meta: 'Channel', image: 'https://…', action: { type: 'session', sessionId: 'a' } }
		app.publishDashboard({ cards: [] });`);
	}
	if (has('screen'))
		publish.push('app.publishScreen({ screenId: SCREEN_ID, root: mainScreen() });');

	const handlers: string[] = [];
	handlers.push(`// The host lets the app publish from now on. Start loading data here.
		onActivate() {
			publish();
		}`);
	if (has('dashboard')) {
		handlers.push(`// The home screen opened: refresh anything that goes stale.
		onRefreshDashboard() {
			publish();
		}`);
	}
	if (has('screen')) {
		handlers.push(`// Something happened on a screen: a button with an \`onSelect\` event id, a text input…
		onUiEvent(event) {
			if (event.screenId === SCREEN_ID && event.eventId === 'reload') publish();
		}`);
	}
	if (has('playback')) {
		handlers.push('resolveStream: ({ sessionId }) => resolveStream(sessionId)');
	}
	if (has('skipSegments')) {
		handlers.push(`// Stretches the player skips: { startSeconds, endSeconds, label }.
		resolveSkipSegments: () => ({ segments: [] })`);
	}
	if (has('chat')) {
		handlers.push(`// A player shows this session's chat: connect, then call app.sendChat(sessionId, batch).
		onOpenChat(sessionId) {
			app.log('info', \`chat opened for \${sessionId}\`);
		},
		onCloseChat(sessionId) {
			app.log('info', \`chat closed for \${sessionId}\`);
		}`);
	}

	return `${imports.join('\n')}
${screen}
defineApp((app) => {
	function publish() {
		${publish.join('\n\t\t') || '// Nothing to publish yet.'}
	}

	return {
		${handlers.join(',\n\n\t\t')}
	};
});
`;
}

// Imports from vitest: `bun test` maps those onto its own runner, and the same file runs
// under vitest on Node, so the tests use no Bun-only API.
const manifestSpec = `import { expect, test } from 'vitest';
import { appManifestSchema } from '@pivi/sdk/manifest';
import manifest from './manifest.json';

// The host refuses an image whose manifest label does not validate.
test('the manifest is valid', () => {
	const parsed = appManifestSchema.safeParse(manifest);
	expect(parsed.error?.issues ?? []).toEqual([]);
});
`;

export function projectFiles(o: InitOptions): Record<string, string> {
	const files: Record<string, string> = {
		'manifest.json': manifestFile(o),
		'main.ts': mainFile(o),
		'service.ts': serviceFile(o),
		'manifest.spec.ts': manifestSpec,
		Containerfile: containerfile(),
		'.containerignore': containerignore,
		'.gitignore': `node_modules\n${DEV_DIR}\ndist\n`,
		'package.json': json({
			name: `pivi-app-${o.id}`,
			// No version: the app's version is manifest.json's.
			private: true,
			type: 'module',
			scripts: {
				dev: 'pivi-app dev',
				'dev:watch': 'pivi-app dev --watch',
				validate: 'pivi-app validate',
				test: 'bun test',
				typecheck: 'tsc --noEmit',
				image: 'pivi-app build',
				publish: 'pivi-app publish'
			},
			dependencies: { '@pivi/sdk': o.sdkSpec, ...sdkPeerDependencies() },
			devDependencies: {
				'@pivi/cli': o.cliSpec,
				'@types/node': '^26.6.6',
				typescript: '^7.0.2',
				vitest: '^5.1.0'
			}
		}),
		'tsconfig.json': json({
			compilerOptions: {
				target: 'ES2023',
				module: 'ESNext',
				moduleResolution: 'bundler',
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				resolveJsonModule: true,
				// Node's types, not Bun's: the image runs the app on Node, so a Bun API is a type error.
				types: ['node']
			},
			include: ['*.ts', 'manifest.json']
		})
	};
	return files;
}
