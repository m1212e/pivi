// vscode-jsonrpc only ships stream based readers and writers, but our
// transports deliver messages through callbacks: the TV's relay socket
// (RemoteBridge), the phone's decrypted pairing session (remoteController), the
// app host's IPC channel (api/apps/runtime.ts) and app stdio (stdioConnection).
import {
	AbstractMessageReader,
	AbstractMessageWriter,
	type Disposable,
	type Message
} from 'vscode-jsonrpc';

/** Lets callback based transports feed vscode-jsonrpc. Call `push` per incoming message. */
export class PushMessageReader extends AbstractMessageReader {
	private callback?: (data: Message) => void;

	// Called by vscode-jsonrpc itself (MessageConnection wiring), not by our
	// own code, so static analysis can't see it's reachable.
	listen(callback: (data: Message) => void): Disposable {
		this.callback = callback;
		return { dispose: () => (this.callback = undefined) };
	}

	// Called by the transport glue whenever a raw message arrives.
	push(message: Message) {
		this.callback?.(message);
	}

	// Lets the owner signal a dropped transport so the connection shuts down
	close() {
		this.fireClose();
	}
}

/** Lets vscode-jsonrpc send over any transport. The sink does the actual sending. */
export class SinkMessageWriter extends AbstractMessageWriter {
	constructor(private sink: (message: Message) => void) {
		super();
	}

	// Called by vscode-jsonrpc itself whenever it sends a message, not by our
	// own code, so static analysis can't see it's reachable.
	write(msg: Message): Promise<void> {
		this.sink(msg);
		return Promise.resolve();
	}

	// Nothing to flush or close, the sink owns the underlying transport.
	end() {}
}
