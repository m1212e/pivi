// The wire framing between the host and an app: UTF-8 JSON, one message per
// line. Chosen over LSP-style Content-Length framing because every language can
// do it with a plain line reader and `println`, and a message never contains a
// raw newline (JSON escapes them), so no length bookkeeping is needed.
//
// Shared by the host (src/api/apps/runtime.ts) and the TypeScript SDK
// (stdioConnection.ts); an app in any other language implements the same few
// lines itself.

// Writes are split into chunks no larger than this. The sandbox's stdin channel
// caps a single frame (4 MiB in microsandbox), but the stream is just bytes, so
// splitting is invisible to the reader.
const MAX_WRITE_CHUNK_BYTES = 1 << 20;

// A single message larger than this is treated as the app misbehaving rather
// than buffered without bound.
const MAX_MESSAGE_BYTES = 64 << 20;

export function encodeMessage(message: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(message)}\n`);
}

export function* chunkBytes(data: Uint8Array, size = MAX_WRITE_CHUNK_BYTES): Generator<Uint8Array> {
	for (let offset = 0; offset < data.length; offset += size) {
		yield data.subarray(offset, offset + size);
	}
}

// Reassembles lines from arbitrarily split chunks. A multi-byte character cut
// across two chunks is decoded correctly (the decoder streams), and a trailing
// partial line is held until its newline arrives.
export class LineSplitter {
	private readonly decoder = new TextDecoder('utf-8', { fatal: false });
	private pending = '';

	constructor(private readonly maxMessageBytes = MAX_MESSAGE_BYTES) {}

	// Returns every complete, non-empty line in `chunk`. Throws when a single
	// message outgrows the limit; the caller should drop the connection.
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
