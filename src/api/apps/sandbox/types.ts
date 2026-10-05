// What the app host needs from a sandbox, independent of what provides it.
// The first (and only) backend is microsandbox (microsandbox.ts): a microVM per
// app, so an app's code gets its own kernel rather than sharing the
// host's. Keeping the host talking to this narrow interface is what lets the
// backend be swapped without touching the protocol, the manifest or anything
// else about how apps work.

export type VolumeSpec = {
	// Where the app sees it.
	guestPath: '/storage' | '/cache';
	// Host-side volume name; stable per (app, profile) so data survives a restart.
	name: string;
	// Hard size limit, so an app can't fill the disk.
	quotaMiB: number;
};

export type SandboxSpec = {
	// Unique per running app; a leftover sandbox with this name is replaced.
	name: string;
	// A digest-pinned image reference to pull and boot.
	image: string;
	// ENTRYPOINT + CMD: the process that speaks the protocol.
	command: string[];
	workingDir?: string;
	memoryMiB: number;
	cpus: number;
	// Outbound access to exactly these domains (an exact host, or `*.suffix`),
	// and nothing else — not the LAN, localhost or the host. `null` means no
	// network at all.
	network: { domains: string[] } | null;
	volumes: VolumeSpec[];
};

export type SandboxHandlers = {
	onStdout(chunk: Uint8Array): void;
	onStderr(chunk: Uint8Array): void;
	// Called exactly once, however the process ended — including when the
	// sandbox is killed from outside, which produces no exit code (`null`).
	onExit(code: number | null): void;
};

export type RunningSandbox = {
	// Writes in order and never interleaves two messages' chunks.
	write(data: Uint8Array): Promise<void>;
	// Stops the process and tears the sandbox down. Safe to call twice.
	stop(): Promise<void>;
};

export interface SandboxBackend {
	// Downloads an image so it can later start without the network — done at
	// install time, where a slow first pull is expected, not at first use.
	prepare(image: string): Promise<void>;
	// Frees the downloaded copy of an image no installed app uses any more.
	removeImage(image: string): Promise<void>;
	start(spec: SandboxSpec, handlers: SandboxHandlers): Promise<RunningSandbox>;
	// Removes the volumes whose name satisfies `predicate` (uninstall, deleted profile).
	removeVolumes(predicate: (name: string) => boolean): Promise<void>;
	// Removes every sandbox whose name starts with `prefix` — leftovers of a
	// host that exited without stopping its apps.
	removeStale(prefix: string): Promise<void>;
}
