import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, expect, it } from 'vitest';

const fixture = new URL('../test/fixtures/good', import.meta.url).pathname;
const cli = new URL('./cli.ts', import.meta.url).pathname;

let client: Client | undefined;
afterEach(async () => {
	await client?.close();
	client = undefined;
});

const text = (result: unknown) =>
	((result as { content: { text: string }[] }).content ?? []).map((c) => c.text).join('\n');

it('serves the dev harness as MCP tools', async () => {
	client = new Client({ name: 'test', version: '1' });
	// The CLI from source, against the SDK's sources (no build needed).
	await client.connect(
		new StdioClientTransport({
			command: 'bun',
			args: ['--conditions', 'pivi-source', cli, 'mcp', fixture],
			stderr: 'ignore'
		})
	);

	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name)).toEqual(
		expect.arrayContaining([
			'validate',
			'start',
			'status',
			'screen',
			'event',
			'stream',
			'domains',
			'problems',
			'build'
		])
	);
	expect(tools.map((t) => t.name)).not.toContain('publish');

	expect(text(await client.callTool({ name: 'validate', arguments: {} }))).toMatch(/valid|warning/);
	expect(text(await client.callTool({ name: 'status', arguments: {} }))).toMatch(/screens:\s+main/);
	expect(text(await client.callTool({ name: 'screen', arguments: { id: 'main' } }))).toContain(
		'button "Go"'
	);

	await client.callTool({ name: 'event', arguments: { screenId: 'main', eventId: 'go' } });
	expect(text(await client.callTool({ name: 'screen', arguments: {} }))).toContain('second');
	expect(text(await client.callTool({ name: 'problems', arguments: {} }))).toContain(
		'No problems.'
	);
}, 60_000);
