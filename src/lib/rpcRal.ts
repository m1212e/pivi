// vscode-jsonrpc needs a "Runtime Abstraction Layer" installed before
// createMessageConnection works — normally done by importing its /node or
// /browser subpath as a side effect. Both of those subpaths declare only
// one export condition each ("node"/"browser") with no unconditional
// fallback, which Vite's SSR module transform and dependency scanner don't
// resolve consistently for code that's reachable from both a server and a
// browser build (RemoteBridge.svelte, the phone remote page, and anything
// importing #lib/rpc transitively) — the transform step tries to resolve
// *every* import it finds, including ones behind a dynamic import that
// would never execute in that environment, so it fails regardless of any
// runtime guard.
//
// The actual RAL interface only needs APIs universally available in both
// Node and the browser (TextEncoder/TextDecoder, timers, console, JSON) —
// we don't use vscode-jsonrpc's own stream wrappers, since
// PushMessageReader/SinkMessageWriter (rpcTransport.ts) implement
// AbstractMessageReader/AbstractMessageWriter directly. So one small,
// environment-agnostic implementation works everywhere, sidestepping the
// subpath resolution problem entirely instead of fighting Vite over it.
import { AbstractMessageBuffer, RAL, type Message } from 'vscode-jsonrpc';

class MessageBuffer extends AbstractMessageBuffer {
	private static readonly EMPTY = new Uint8Array(0);
	private readonly asciiDecoder = new TextDecoder('ascii');

	protected emptyBuffer(): Uint8Array {
		return MessageBuffer.EMPTY;
	}

	protected fromString(value: string): Uint8Array {
		return new TextEncoder().encode(value);
	}

	protected toString(value: Uint8Array, encoding: RAL.MessageBufferEncoding): string {
		return encoding === 'ascii'
			? this.asciiDecoder.decode(value)
			: new TextDecoder(encoding).decode(value);
	}

	protected asNative(buffer: Uint8Array, length?: number): Uint8Array {
		return length === undefined ? buffer : buffer.slice(0, length);
	}

	protected allocNative(length: number): Uint8Array {
		return new Uint8Array(length);
	}
}

let installed = false;

// Idempotent and safe to call from every module that needs a connection —
// vscode-jsonrpc's RAL.install() throws if called twice.
export function ensureRal(): void {
	if (installed) return;
	installed = true;

	const textEncoder = new TextEncoder();

	RAL.install({
		messageBuffer: { create: (encoding) => new MessageBuffer(encoding) },
		applicationJson: {
			encoder: {
				name: 'application/json',
				encode: (msg: Message, options) => {
					if (options.charset !== 'utf-8') {
						throw new Error(`Only utf-8 is supported, got: ${options.charset}`);
					}
					return Promise.resolve(textEncoder.encode(JSON.stringify(msg)));
				}
			},
			decoder: {
				name: 'application/json',
				decode: (buffer, options) =>
					Promise.resolve(JSON.parse(new TextDecoder(options.charset).decode(buffer)))
			}
		},
		console,
		timer: {
			setTimeout: (callback, ms, ...args) => {
				const handle = setTimeout(callback, ms, ...args);
				return { dispose: () => clearTimeout(handle) };
			},
			// Neither Node nor the browser need vscode-jsonrpc's own
			// microtask/queueMicrotask juggling here — a 0ms timeout is fine
			// for both, and keeps this implementation identical everywhere.
			setImmediate: (callback, ...args) => {
				const handle = setTimeout(callback, 0, ...args);
				return { dispose: () => clearTimeout(handle) };
			},
			setInterval: (callback, ms, ...args) => {
				const handle = setInterval(callback, ms, ...args);
				return { dispose: () => clearInterval(handle) };
			}
		}
	});
}
