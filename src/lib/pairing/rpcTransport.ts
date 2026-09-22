import {
	AbstractMessageReader,
	AbstractMessageWriter,
	type Disposable,
	type Message
} from 'vscode-jsonrpc';

export class PushMessageReader extends AbstractMessageReader {
	private callback?: (data: Message) => void;

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

	write(msg: Message): Promise<void> {
		this.sink(msg);
		return Promise.resolve();
	}

	end() {}
}
