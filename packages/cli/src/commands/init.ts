import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as p from '@clack/prompts';
import {
	FEATURES,
	ID_PATTERN,
	generateProject,
	normalizeOptions,
	titleCase,
	writeProject,
	type AgentFiles,
	type CiPlatform,
	type InitOptions
} from '../generate';

const HELP = `pivi-app init [dir]

Scaffolds a new pivi app. Without --yes it asks for what you did not pass.

  --id <id>              lowercase letters, digits, dashes (default: the directory name)
  --name <name>          display name
  --description <text>   one line, at most 140 characters
  --features <list>      comma separated: ${FEATURES.join(', ')}
  --domains <list>       comma separated hosts the app contacts (*.example.com allowed)
  --storage              the app keeps data across restarts (adds the storage permission)
  --ci <github|none>     CI workflow to generate (default github)
  --agent <claude|agents|none>
                         files for AI coding agents (default claude)
  --sdk <spec>           how package.json depends on @pivi/sdk (default: the range this CLI supports)
  --cli <spec>           how package.json depends on @pivi/cli (default: this CLI's version)
  --no-install           do not run bun install
  --force                write into a directory that is not empty
  --yes                  take defaults for everything not passed, never prompt
`;

const list = (value: string | undefined) =>
	value
		?.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

function cancelled<T>(value: T): Exclude<T, symbol> {
	if (p.isCancel(value)) {
		p.cancel('Cancelled.');
		process.exit(130);
	}
	return value as Exclude<T, symbol>;
}

type Values = ReturnType<typeof parseInitArgs>['values'];
type Draft = Partial<InitOptions> & { id: string };

function parseInitArgs(args: string[]) {
	return parseArgs({
		args,
		allowPositionals: true,
		options: {
			id: { type: 'string' },
			name: { type: 'string' },
			description: { type: 'string' },
			features: { type: 'string' },
			domains: { type: 'string' },
			storage: { type: 'boolean' },
			ci: { type: 'string' },
			agent: { type: 'string' },
			sdk: { type: 'string' },
			cli: { type: 'string' },
			'no-install': { type: 'boolean' },
			force: { type: 'boolean' },
			yes: { type: 'boolean', short: 'y' },
			help: { type: 'boolean', short: 'h' }
		}
	});
}

const idFromDirectory = (target: string) =>
	basename(target)
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** The target directory and app id, asked for when interactive and not passed. */
async function askLocation(dirArg: string | undefined, values: Values, interactive: boolean) {
	let dir = dirArg;
	if (!dir && interactive) {
		dir = cancelled(
			await p.text({ message: 'Directory', placeholder: 'my-app', defaultValue: 'my-app' })
		);
	}
	const target = resolve(dir ?? '.');
	let id = values.id ?? idFromDirectory(target);
	if (interactive && !values.id) {
		id = cancelled(
			await p.text({
				message: 'App id (lowercase letters, digits, dashes)',
				initialValue: id || 'my-app',
				validate: (v) =>
					ID_PATTERN.test(v ?? '') ? undefined : 'Lowercase letters, digits and dashes only'
			})
		);
	}
	return { target, id };
}

function fromFlags(id: string, values: Values): Draft {
	return {
		id,
		name: values.name,
		description: values.description,
		features: list(values.features) as InitOptions['features'] | undefined,
		domains: list(values.domains),
		storage: values.storage,
		ci: values.ci as CiPlatform | undefined,
		agent: values.agent as AgentFiles | undefined,
		sdkSpec: values.sdk,
		cliSpec: values.cli
	};
}

/** What the app is and does. */
async function askApp(partial: Draft) {
	partial.name ??= cancelled(
		await p.text({ message: 'Display name', initialValue: titleCase(partial.id) })
	);
	partial.description ??= cancelled(
		await p.text({
			message: 'One line description',
			initialValue: `Watch ${partial.name} on pivi`,
			validate: (v) => ((v?.length ?? 0) > 140 ? 'At most 140 characters' : undefined)
		})
	);
	partial.features ??= cancelled(
		await p.multiselect({
			message: 'What does the app do?',
			options: [
				{ value: 'dashboard', label: 'dashboard', hint: 'cards on the home screen' },
				{ value: 'screen', label: 'screen', hint: 'its own pages (browse, search, settings)' },
				{ value: 'playback', label: 'playback', hint: 'plays video' },
				{ value: 'skipSegments', label: 'skipSegments', hint: 'sponsor/intro skipping' },
				{ value: 'chat', label: 'chat', hint: 'live chat beside a stream' }
			],
			initialValues: ['dashboard', 'screen', 'playback'],
			required: true
		})
	) as InitOptions['features'];
	partial.domains ??= list(
		cancelled(
			await p.text({
				message: 'Hosts the app contacts (comma separated, you can add more later)',
				placeholder: 'api.example.com, *.cdn.example.com',
				defaultValue: ''
			})
		)
	);
	partial.storage ??= cancelled(
		await p.confirm({ message: 'Does it keep data, such as a sign-in?', initialValue: false })
	);
}

/** The tooling around the app. */
async function askTooling(partial: Draft) {
	partial.ci ??= cancelled(
		await p.select({
			message: 'CI to generate',
			options: [
				{ value: 'github', label: 'GitHub Actions', hint: 'builds and pushes to ghcr.io' },
				{ value: 'none', label: 'none' }
			]
		})
	) as CiPlatform;
	partial.agent ??= cancelled(
		await p.select({
			message: 'Files for AI coding agents',
			options: [
				{ value: 'claude', label: 'Claude Code', hint: 'AGENTS.md, CLAUDE.md and the pivi plugin' },
				{ value: 'agents', label: 'AGENTS.md only' },
				{ value: 'none', label: 'none' }
			]
		})
	) as AgentFiles;
}

/** The complete options, or an error message. */
function finalize(partial: Draft): InitOptions | string {
	let options: InitOptions;
	try {
		options = normalizeOptions(partial);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	if (options.description.length > 140) return 'The description is at most 140 characters.';
	if (options.ci !== 'github' && options.ci !== 'none') {
		return `Unknown --ci "${options.ci}". Supported: github, none.`;
	}
	return options;
}

function install(target: string, interactive: boolean) {
	const spinner = interactive ? p.spinner() : undefined;
	spinner?.start('bun install');
	const result = spawnSync('bun', ['install'], {
		cwd: target,
		stdio: interactive ? 'ignore' : 'inherit'
	});
	spinner?.stop(
		result.error || result.status !== 0
			? 'bun install failed, run it yourself'
			: 'Dependencies installed'
	);
}

export async function init(args: string[]): Promise<number> {
	const { values, positionals } = parseInitArgs(args);
	if (values.help) {
		console.log(HELP);
		return 0;
	}
	const interactive = !values.yes && process.stdin.isTTY === true;
	if (interactive) p.intro('pivi-app init');

	const { target, id } = await askLocation(positionals[0], values, interactive);
	const partial = fromFlags(id, values);
	if (interactive) {
		await askApp(partial);
		await askTooling(partial);
	}
	const options = finalize(partial);
	if (typeof options === 'string') {
		console.error(options);
		return 2;
	}
	if (existsSync(target) && readdirSync(target).length > 0 && !values.force) {
		console.error(`${target} is not empty. Pass --force to write into it anyway.`);
		return 1;
	}

	writeProject(target, generateProject(options));
	if (!values['no-install']) install(target, interactive);

	const dirArg = positionals[0];
	const next = `${dirArg && dirArg !== '.' ? `cd ${dirArg} && ` : ''}bun run dev`;
	if (interactive) p.outro(`Created ${options.name}. Next: ${next}`);
	else console.log(`Created ${options.name} in ${target}\nNext: ${next}`);
	return 0;
}
