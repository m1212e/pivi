// `pivi-app mcp`: the dev harness as an MCP server on stdio, for AI agents. They get
// the same fake host as `pivi-app dev` (validated messages, the network rule,
// stream probes) as typed tools instead of parsing terminal output. Every answer
// also carries what the app did since the previous call.
//
// Publishing is deliberately not a tool: pushing to a registry is an outward action
// an agent should run through the shell, where it can be approved.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { executeCommand } from '../commands';
import { readAppConfig } from '../config';
import { Harness } from '../harness';
import { checkProject } from '../staticChecks';

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };

export async function mcp(dir: string): Promise<number> {
	// stdout carries MCP: everything else this process prints goes to stderr.
	console.log = (...args: unknown[]) => console.error(...args);
	console.info = console.log;

	const config = readAppConfig(dir);
	const events: string[] = [];
	let harness: Harness | undefined;

	const reply = (text: string, isError = false): Text => {
		const recent = events.splice(0);
		const body = recent.length ? `${text}\n\nSince the last call:\n${recent.join('\n')}` : text;
		return { content: [{ type: 'text', text: body }], ...(isError ? { isError } : {}) };
	};
	const failure = (error: unknown) =>
		reply(error instanceof Error ? error.message : String(error), true);

	async function start(options: { locale?: string; enforce?: boolean } = {}) {
		await harness?.close();
		harness = new Harness({
			dir,
			entry: config.entry,
			conditions: config.conditions,
			locale: options.locale,
			enforceNetwork: options.enforce,
			onEvent: (line) => {
				events.push(line);
				if (events.length > 200) events.shift();
			}
		});
		await harness.start();
		await harness.settle(1500);
		return harness;
	}

	/** Runs a dev command, starting the app first if it is not running. */
	const run = async (command: string) => {
		try {
			const h = harness?.running ? harness : await start();
			return reply(await executeCommand(h, command));
		} catch (error) {
			return failure(error);
		}
	};

	const server = new McpServer({ name: 'pivi-app', version: '1' });

	server.registerTool(
		'validate',
		{
			description:
				'Static checks of the app: manifest, features without code, hosts the manifest does not allow, runtime-only APIs.'
		},
		() => {
			const findings = checkProject(dir, config.entry);
			return reply(
				findings.length
					? findings.map((f) => `${f.level}: ${f.message}`).join('\n')
					: 'The app looks valid.'
			);
		}
	);
	server.registerTool(
		'start',
		{
			description:
				'Bundle the app and (re)start it against a fake pivi host. Other tools start it on demand; use this to pick options or to restart after changes.',
			inputSchema: {
				locale: z.string().optional().describe('BCP 47 tag sent in host/activate, default en-US'),
				enforce: z
					.boolean()
					.optional()
					.describe('block hosts outside network.domains (default true)')
			}
		},
		async (args) => {
			try {
				await start(args);
				return reply(await executeCommand(harness!, 'status'));
			} catch (error) {
				return failure(error);
			}
		}
	);
	server.registerTool('stop', { description: 'Stop the app.' }, async () => {
		await harness?.close();
		harness = undefined;
		return reply('stopped');
	});
	server.registerTool('status', { description: 'What the app declares and has published.' }, () =>
		run('status')
	);
	server.registerTool('dashboard', { description: 'The home cards the app published.' }, () =>
		run('dashboard')
	);
	server.registerTool(
		'screen',
		{
			description:
				'A published screen as a tree, with the events and actions each node fires. Without id: the published screen ids.',
			inputSchema: { id: z.string().optional() }
		},
		({ id }) => run(`screen ${id ?? ''}`)
	);
	server.registerTool(
		'event',
		{
			description: 'Fire a UI event on a screen, as a press, text input or toggle would.',
			inputSchema: {
				screenId: z.string(),
				eventId: z.string(),
				value: z.union([z.string(), z.boolean()]).optional()
			}
		},
		({ screenId, eventId, value }) =>
			run(`event ${screenId} ${eventId}${value === undefined ? '' : ` ${value}`}`)
	);
	server.registerTool(
		'stream',
		{
			description:
				'Resolve a session to a stream, validate the answer like the host and probe its URLs (domains, reachability, segment index, HLS playlist hosts).',
			inputSchema: { sessionId: z.string(), maxHeight: z.number().int().positive().optional() }
		},
		({ sessionId, maxHeight }) => run(`stream ${sessionId}${maxHeight ? ` ${maxHeight}` : ''}`)
	);
	server.registerTool(
		'domains',
		{ description: 'Hosts the app connected to, and which network.domains blocked.' },
		() => run('domains')
	);
	server.registerTool(
		'problems',
		{ description: 'Everything the host would reject or drop so far.' },
		() => run('problems')
	);
	server.registerTool(
		'logs',
		{
			description: "The app's stderr.",
			inputSchema: { lines: z.number().int().positive().optional() }
		},
		({ lines }) => run(`logs ${lines ?? 50}`)
	);
	server.registerTool(
		'command',
		{
			description:
				'Any pivi-app dev command (next, skip, live, chat, refresh, locale, ping, call, send, …). `help` lists them.',
			inputSchema: { command: z.string() }
		},
		({ command }) => run(command)
	);
	server.registerTool(
		'build',
		{
			description:
				'Bundle the app and build its image with buildah (or podman) for every platform, without pushing it.'
		},
		async () => {
			try {
				const { build } = await import('./image');
				await build(dir, {
					entry: config.entry,
					conditions: config.conditions
				});
				return reply('Built. Publishing is up to you: `pivi-app publish <registry>/<repository>`.');
			} catch (error) {
				return failure(error);
			}
		}
	);

	await server.connect(new StdioServerTransport());
	await new Promise<void>((resolve) => process.stdin.on('close', resolve));
	await harness?.close();
	return 0;
}
