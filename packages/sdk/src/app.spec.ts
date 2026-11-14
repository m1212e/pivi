import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dashboardContributionSchema } from './dashboard';
import { PROTOCOL_VERSION, resolvedStreamSchema } from './protocol';

// defineApp owns stdin/stdout, so it is tested the way the host uses it: as a
// child process spoken to in newline-delimited JSON-RPC.
function runDemoApp(lines: object[]): Promise<Record<string, unknown>[]> {
	return new Promise((resolve, reject) => {
		const child = spawn('bun', [new URL('../test/demoApp.ts', import.meta.url).pathname], {
			stdio: ['pipe', 'pipe', 'inherit']
		});
		let out = '';
		child.stdout.on('data', (chunk) => (out += chunk));
		child.on('error', reject);
		child.on('close', () =>
			resolve(
				out
					.split('\n')
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			)
		);
		// Closing stdin ends the app once it has answered everything.
		for (const line of lines) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...line }) + '\n');
		setTimeout(() => child.stdin.end(), 500);
	});
}

describe('defineApp', () => {
	it('announces the protocol version first', async () => {
		const [first] = await runDemoApp([]);
		expect(first).toMatchObject({ method: 'app/ready', params: { protocol: PROTOCOL_VERSION } });
	});

	it('publishes from onActivate and answers requests with valid payloads', async () => {
		const messages = await runDemoApp([
			{ method: 'host/activate', params: { locale: 'en-US' } },
			{ id: 1, method: 'app/resolveStream', params: { sessionId: 'bunny' } },
			{ id: 2, method: 'host/ping' }
		]);

		const dashboard = messages.find((m) => m.method === 'app/publishDashboard');
		expect(dashboardContributionSchema.safeParse(dashboard?.params).success).toBe(true);

		const stream = messages.find((m) => m.id === 1);
		expect(resolvedStreamSchema.safeParse(stream?.result).success).toBe(true);
		expect(messages.find((m) => m.id === 2)).toMatchObject({ result: null });
	});

	it('refuses requests it has no handler for', async () => {
		const messages = await runDemoApp([
			{ id: 1, method: 'app/resolveNext', params: { sessionId: 'x' } }
		]);
		expect(messages.find((m) => m.id === 1)).toHaveProperty('error');
	});
});
