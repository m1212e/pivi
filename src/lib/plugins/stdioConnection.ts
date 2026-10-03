// The plugin end of the protocol for TypeScript/JavaScript plugins running
// under Bun or Node: a vscode-jsonrpc connection over this process's own
// stdin/stdout (see ndjson.ts for the framing). A convenience only — the
// protocol is plain JSON-RPC lines, and a plugin in another language just
// implements those few lines itself.
//
// stdout *is* the channel, so anything else printed there would corrupt it.
// console.log is rerouted to stderr (the log stream) up front, before any other
// code gets a chance to use it.
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
import { ensureRal } from '#lib/rpcRal';
import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';
import { encodeMessage, LineSplitter } from './ndjson';

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
	process.stdin.on('end', () => reader.close());

	ensureRal();
	const connection = createMessageConnection(reader, writer);
	connection.listen();
	return connection;
}
