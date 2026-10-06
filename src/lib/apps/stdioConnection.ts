import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
import { ensureRal } from '#lib/rpcRal';
import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';
import { encodeMessage, LineSplitter } from './ndjson';

/**
 * The app side of the host protocol for TypeScript apps (apps/youtube), so
 * they don't each reimplement the stdio framing. stdout is the channel, so
 * console.log is moved to stderr. Call once at startup, before anything prints.
 */
export function createStdioConnection(): MessageConnection {
	console.log = (...args: unknown[]) => console.error(...args);
	console.info = (...args: unknown[]) => console.error(...args);

	const reader = new PushMessageReader();
	const writer = new SinkMessageWriter((message) => {
		process.stdout.write(encodeMessage(message));
	});

	const splitter = new LineSplitter();
	process.stdin.on('data', (chunk: Uint8Array) => {
		for (const line of splitter.push(chunk)) {
			try {
				reader.push(JSON.parse(line));
			} catch (error) {
				console.error('Dropped an unparsable protocol line:', String(error));
			}
		}
	});
	// Host closing stdin means the app is being stopped.
	process.stdin.on('end', () => reader.close());

	ensureRal();
	const connection = createMessageConnection(reader, writer);
	connection.listen();
	return connection;
}
