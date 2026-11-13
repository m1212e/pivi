// vscode-jsonrpc needs a runtime layer installed before any connection works,
// normally via its /node or /browser subpath. Bundlers don't resolve those
// consistently for code shared by server and browser builds, so this installs
// one small implementation that works in Node, Bun and the browser alike.
import { AbstractMessageBuffer, RAL, type Message } from 'vscode-jsonrpc';

// Uint8Array based buffer, so no Node Buffer is needed in the browser.
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

/**
 * Call before every createMessageConnection. Repeated calls are fine even
 * though RAL.install() itself throws on a second call.
 */
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
			// A 0ms timeout is good enough for both Node and the browser and keeps
			// this implementation identical everywhere.
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
