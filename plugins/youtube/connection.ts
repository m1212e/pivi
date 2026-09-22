// This plugin's end of the child-process RPC channel the host sets up in
// src/api/plugins/runtime.ts. A forked Node/Bun child process already gets
// an IPC channel for free (`process.send`/`process.on('message')`,
// pre-parsed objects, no manual JSON framing needed) — the same push-based
// seam PushMessageReader/SinkMessageWriter were built for.
// The bare package, not a /node subpath — see rpcRal.ts for why.
import { createMessageConnection } from 'vscode-jsonrpc';
import { ensureRal } from '#lib/rpcRal';
import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';

const reader = new PushMessageReader();
const writer = new SinkMessageWriter((msg) => {
	process.send?.(msg);
});
process.on('message', (msg) => reader.push(msg as never));

ensureRal();
export const connection = createMessageConnection(reader, writer);
connection.listen();
