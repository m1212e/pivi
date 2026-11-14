#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { dev } from './commands/dev';
import { manifest } from './commands/manifest';
import { validate } from './commands/validate';

const USAGE = `pivi-app: build, test and ship pivi apps

Usage:
  pivi-app init [dir]        scaffold a new app (prompts, or flags with --yes)
  pivi-app validate [dir]    check the manifest and common mistakes without running
  pivi-app dev [dir]         run the app against a fake pivi host
  pivi-app manifest [dir]    print the validated manifest (the dev.pivi.manifest label)

Options:
  --entry <file>     the app's entry file (default main.ts)
  dev:      --exec <command>  run a command and exit (repeatable), non-zero on problems
            --watch           restart when files change
            --no-enforce      do not block connections outside network.domains
            --locale <tag>    the locale sent in host/activate (default en-US)
  validate: --strict          treat warnings as errors
            --json            machine readable output
  init:     run "pivi-app init --help"
`;

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	if (!command || command === '--help' || command === '-h' || command === 'help') {
		console.log(USAGE);
		return 0;
	}
	if (command === '--version' || command === '-v') {
		console.log(createRequire(import.meta.url)('../package.json').version);
		return 0;
	}

	const { values, positionals } = parseArgs({
		args: rest,
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
			runtime: { type: 'string' }
		}
	});
	const dir = positionals[0] ?? '.';

	switch (command) {
		case 'validate':
			return validate(dir, {
				entry: values.entry as string | undefined,
				strict: !!values.strict,
				json: !!values.json
			});
		case 'manifest':
			return manifest(dir);
		case 'dev':
			return dev(dir, {
				entry: values.entry as string | undefined,
				exec: (values.exec as string[] | undefined) ?? [],
				watch: !!values.watch,
				// `--no-enforce` arrives as enforce=false only with allowNegative, so read the raw args.
				enforce: !rest.includes('--no-enforce'),
				locale: values.locale as string | undefined,
				runtime: values.runtime ? (values.runtime as string).split(' ') : undefined
			});
		case 'init': {
			const { init } = await import('./commands/init');
			return init(rest);
		}
		default:
			console.error(`Unknown command "${command}".\n\n${USAGE}`);
			return 2;
	}
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
);
