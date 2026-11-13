// Wire framing for the host/app protocol, shared by the host (runtime.ts) and
// the TypeScript SDK (stdioConnection.ts). One JSON message per line instead
// of LSP-style Content-Length, so an app in any language can speak it with a
// plain line reader and println.

// Writes are split into chunks no larger than this. The sandbox's stdin channel
// caps a single frame (4 MiB in microsandbox), but the stream is just bytes, so
// splitting is invisible to the reader.
const MAX_WRITE_CHUNK_BYTES = 1 << 20;

// A single message larger than this is treated as the app misbehaving rather
// than buffered without bound.
const MAX_MESSAGE_BYTES = 64 << 20;

/** The sending half of the framing, used by both the host runtime and the app SDK. */
export function encodeMessage(message: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(message)}\n`);
}

/** Used by the microsandbox backend so a large message never exceeds its stdin frame cap. */
export function* chunkBytes(data: Uint8Array, size = MAX_WRITE_CHUNK_BYTES): Generator<Uint8Array> {
	for (let offset = 0; offset < data.length; offset += size) {
		yield data.subarray(offset, offset + size);
	}
}

/**
 * The receiving half of the framing, since stdio delivers arbitrary chunks
 * rather than whole lines. Handles multi-byte characters split across chunks
 * and holds a partial line until its newline arrives.
 */
export class LineSplitter {
	private readonly decoder = new TextDecoder('utf-8', { fatal: false });
	private pending = '';

	constructor(private readonly maxMessageBytes = MAX_MESSAGE_BYTES) {}

	// Returns every complete, non-empty line in `chunk`. Throws when a single
	// message outgrows the limit, and the caller should drop the connection.
	push(chunk: Uint8Array): string[] {
		this.pending += this.decoder.decode(chunk, { stream: true });
		const lines = this.pending.split('\n');
		this.pending = lines.pop() ?? '';

		if (this.pending.length > this.maxMessageBytes) {
			throw new Error(`Message exceeds ${this.maxMessageBytes} bytes without a newline`);
		}
		return lines.map((line) => line.replace(/\r$/, '')).filter((line) => line.length > 0);
	}
}
