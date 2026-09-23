// A push-based MessageReader/MessageWriter pair for vscode-jsonrpc, for
// transports that hand you messages via a callback rather than exposing a
// readable/writable stream: a WebSocket's `onmessage` (RemoteBridge.svelte,
// the phone remote page), or the pairing session's already-decrypted
// `onMessage` callback (session.ts). Nothing here is specific to any one of
// those — it's the same seam the plugin host (api/plugins/runtime.ts) uses
// for its child-process IPC channel.
import {
	AbstractMessageReader,
	AbstractMessageWriter,
	type Disposable,
	type Message
} from 'vscode-jsonrpc';

export class PushMessageReader extends AbstractMessageReader {
	private callback?: (data: Message) => void;

	// Called by vscode-jsonrpc itself (MessageConnection wiring), not by our
	// own code, so static analysis can't see it's reachable.
	// fallow-ignore-next-line unused-class-member
	listen(callback: (data: Message) => void): Disposable {
		this.callback = callback;
		return { dispose: () => (this.callback = undefined) };
	}

	// Called by the transport glue whenever a raw message arrives.
	push(message: Message) {
		this.callback?.(message);
	}

	close() {
		this.fireClose();
	}
}

export class SinkMessageWriter extends AbstractMessageWriter {
	constructor(private sink: (message: Message) => void) {
		super();
	}

	// Called by vscode-jsonrpc itself whenever it sends a message, not by our
	// own code, so static analysis can't see it's reachable.
	// fallow-ignore-next-line unused-class-member
	write(msg: Message): Promise<void> {
		this.sink(msg);
		return Promise.resolve();
	}

	// fallow-ignore-next-line unused-class-member
	end() {}
}
