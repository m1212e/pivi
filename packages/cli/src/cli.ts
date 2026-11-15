#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { dev } from './commands/dev';
import { readAppConfig } from './config';
import { manifest } from './commands/manifest';
import { validate } from './commands/validate';

const USAGE = `pivi-app: build, test and ship pivi apps

Usage:
  pivi-app init [dir]        scaffold a new app (prompts, or flags with --yes)
  pivi-app validate [dir]    check the manifest and common mistakes without running
  pivi-app dev [dir]         run the app against a fake pivi host
  pivi-app manifest [dir]    print the validated manifest (the dev.pivi.manifest label)
  pivi-app keygen [prefix]   create a key pair for signing (with skopeo)
  pivi-app mcp [dir]         the dev harness as an MCP server on stdio, for AI agents
  pivi-app build [dir]       bundle the app and build its image with buildah
  pivi-app publish [dir] <ref>
                             build and push to any OCI registry, e.g. ghcr.io/me/my-app

Options:
  --entry <file>     the app's entry file (default main.ts)
  dev:      --exec <command>  run a command and exit (repeatable), non-zero on problems
            --watch           restart when files change
            --preview[=port]  serve a visual preview of the screens on 127.0.0.1
            --no-enforce      do not block connections outside network.domains
            --locale <tag>    the locale sent in host/activate (default en-US)
  validate: --strict          treat warnings as errors
            --json            machine readable output
  build, publish (with buildah, or podman):
            --platform <list> default linux/amd64,linux/arm64
            --conditions <c>  export condition for bundling (repeatable)
  build:    --out <dir>       also write the image as an OCI layout
  publish:  --sign <key>      sign with this private key (or PIVI_SIGNING_KEY: a path or the
                              key itself, PIVI_SIGNING_PASSPHRASE: its passphrase)
            --tag <tag>       an extra tag (repeatable). Without a tag in <ref> the
                              image is tagged with the manifest version and latest.
            Credentials: PIVI_REGISTRY_USERNAME and PIVI_REGISTRY_PASSWORD, or the
            auths of the docker config (docker login).
  init:     run "pivi-app init --help"

The image is described by the app's Containerfile (pivi-app init writes one; without
it a default one is used). Settings can also live in the app's package.json,
under "pivi": platforms, entry and conditions. Flags win.
`;

function parseFlags(args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		strict: false,
		options: {
			entry: { type: 'string' },
			exec: { type: 'string', multiple: true },
			watch: { type: 'boolean' },
			enforce: { type: 'boolean' },
			locale: { type: 'string' },
			strict: { type: 'boolean' },
			json: { type: 'boolean' },
			platform: { type: 'string' },
			conditions: { type: 'string', multiple: true },
			out: { type: 'string' },
			tag: { type: 'string', multiple: true },
			sign: { type: 'string' },
			preview: { type: 'string' }
		}
	});
	const text = (key: string) => values[key] as string | undefined;
	const list = (key: string) => values[key] as string[] | undefined;
	return { args, values, positionals, text, list, dir: positionals[0] ?? '.' };
}

type Flags = ReturnType<typeof parseFlags>;

function runDev({ args, values, text, list, dir }: Flags) {
	const config = readAppConfig(dir);
	return dev(dir, {
		entry: text('entry') ?? config.entry,
		exec: list('exec') ?? [],
		watch: !!values.watch,
		// `--no-enforce` arrives as enforce=false only with allowNegative, so read the raw args.
		enforce: !args.includes('--no-enforce'),
		locale: text('locale'),
		conditions: list('conditions') ?? config.conditions,
		// `--preview` alone takes any free port, `--preview=4173` that one.
		preview:
			values.preview === undefined
				? undefined
				: Number(values.preview === true ? 0 : values.preview) || 0
	});
}

async function runImage(command: 'build' | 'publish', { positionals, text, list, dir }: Flags) {
	const { build, publish, parsePlatforms } = await import('./commands/image');
	// For publish, one positional is the reference, two are the directory and the reference.
	const [first, second] = positionals;
	const appDir = command === 'publish' ? (second ? first! : '.') : dir;
	const config = readAppConfig(appDir);
	const options = {
		entry: text('entry') ?? config.entry,
		platforms: parsePlatforms(text('platform') ?? config.platforms?.join(',')),
		conditions: list('conditions') ?? config.conditions
	};
	if (command === 'build') return build(appDir, { ...options, out: text('out') });
	return publish(appDir, second ?? first, { ...options, tags: list('tag'), sign: text('sign') });
}

const COMMANDS: Record<string, (flags: Flags) => number | Promise<number>> = {
	validate: ({ values, text, dir }) =>
		validate(dir, { entry: text('entry'), strict: !!values.strict, json: !!values.json }),
	manifest: ({ dir }) => manifest(dir),
	dev: runDev,
	build: (flags) => runImage('build', flags),
	publish: (flags) => runImage('publish', flags),
	init: async ({ args }) => (await import('./commands/init')).init(args),
	mcp: async ({ dir }) => (await import('./commands/mcp')).mcp(dir),
	keygen: async ({ positionals }) => (await import('./commands/image')).keygen(positionals[0])
};

function main(argv: string[]): number | Promise<number> {
	const [command, ...rest] = argv;
	if (!command || ['--help', '-h', 'help'].includes(command)) {
		console.log(USAGE);
		return 0;
	}
	if (command === '--version' || command === '-v') {
		console.log(createRequire(import.meta.url)('../package.json').version);
		return 0;
	}
	const run = COMMANDS[command];
	if (!run) {
		console.error(`Unknown command "${command}".\n\n${USAGE}`);
		return 2;
	}
	return run(parseFlags(rest));
}

Promise.resolve()
	.then(() => main(process.argv.slice(2)))
	.then(
		(code) => process.exit(code),
		(error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		}
	);
