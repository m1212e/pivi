// The sandbox backend: one microsandbox microVM per running app (hardware
// isolation via KVM, its own kernel, its own root filesystem).
//
// What was verified about it, and what that means here (see SKETCH.md):
//   - Network is deny-by-default and filtered per domain. Hostname rules are
//     only trustworthy with TLS interception on: without it the HTTP Host
//     header can't be inspected, and a request fronted through an allowed IP
//     reaches other sites. So interception is always enabled when there's any
//     network, and the guest's own DNS is filtered too.
//   - A write to a process's stdin is capped at 4 MiB per frame, so messages are
//     chunked (ndjson.ts's chunkBytes) and chunks are serialised.
//   - A VM killed from outside ends the output stream without an "exited"
//     event, so the end of the stream is treated as an exit too.
//   - The runtime keeps a unix socket per sandbox under its home directory, whose
//     path must be short (< 108 bytes), hence PIVI_SANDBOX_HOME.
import { chunkBytes } from '#lib/apps/ndjson';
import { isLocalRegistry } from '../registry';
import { SANDBOX_PREFIX } from './spec';
import type { RunningSandbox, SandboxBackend, SandboxHandlers, SandboxSpec } from './types';

// Type only, the real import stays lazy (see loadRuntime).
type Msb = typeof import('microsandbox');

let runtime: Promise<Msb> | undefined;

// Loaded lazily, so a machine without KVM (a development laptop, CI) can run
// everything except an actual app, and so importing this module is free.
function loadRuntime(): Promise<Msb> {
	runtime ??= (async () => {
		const home = process.env.PIVI_SANDBOX_HOME;
		if (home) process.env.MSB_HOME = home;
		const msb = await import('microsandbox');
		await msb.ensureRuntime();
		return msb;
	})();
	return runtime;
}

// An image pulled from a registry on this machine is fetched over plain HTTP,
// matching how the registry client reaches it. Any other registry is HTTPS.
const usesLocalRegistry = (image: string) => isLocalRegistry(image.split('/')[0]);

// Apps only get web traffic, whatever the domain.
const WEB_PORTS = [80, 443];

// The default TLS configuration is the one that intercepts (see the header).
const interceptTls = <T>(tls: T): T => tls;

// `*.example.com` covers the suffix and the bare domain itself. The sandbox's
// own suffix rule only promises subdomains, so the apex gets its own rule.
function buildNetworkPolicy(msb: Msb, domains: readonly string[]) {
	const policy = msb.NetworkPolicy.builder().defaultDeny();
	for (const domain of domains) {
		if (domain.startsWith('*.')) {
			const apex = domain.slice(2);
			policy.egress((rule) => rule.tcp().ports(WEB_PORTS).allowDomain(apex));
			policy.egress((rule) => rule.tcp().ports(WEB_PORTS).allowDomainSuffix(apex));
		} else {
			policy.egress((rule) => rule.tcp().ports(WEB_PORTS).allowDomain(domain));
		}
	}
	return policy.build();
}

// Created on first use so volumes exist exactly when a permission needs them.
async function ensureVolume(msb: Msb, name: string, quotaMiB: number): Promise<void> {
	try {
		await msb.Volume.get(name);
	} catch {
		await msb.Volume.builder(name).quota(quotaMiB).create();
	}
}

// Where the spec's limits and grants actually turn into VM settings.
async function createSandbox(msb: Msb, spec: SandboxSpec) {
	for (const volume of spec.volumes) await ensureVolume(msb, volume.name, volume.quotaMiB);

	let builder = msb.Sandbox.builder(spec.name)
		.image(spec.image)
		.cpus(spec.cpus)
		.memory(spec.memoryMiB)
		// Gone when it stops, rather than accumulating a root filesystem per run.
		.ephemeral(true)
		.replace();

	if (usesLocalRegistry(spec.image)) builder = builder.registry((registry) => registry.insecure());

	for (const volume of spec.volumes) {
		builder = builder.volume(volume.guestPath, (mount) =>
			mount.named(volume.name).nosuid().nodev()
		);
	}

	builder = spec.network
		? builder.network((network) =>
				network.policy(buildNetworkPolicy(msb, spec.network!.domains)).tls(interceptTls)
			)
		: builder.disableNetwork();

	return builder.create();
}

// Starts the app's command and forwards its output. Returns stdin, the host's
// only way to talk to it.
async function startProcess(
	sandbox: Awaited<ReturnType<typeof createSandbox>>,
	spec: SandboxSpec,
	handlers: SandboxHandlers
) {
	const [program, ...args] = spec.command;
	const handle = await sandbox.execStreamWith(program, (exec) => {
		let configured = exec.args(args).stdinPipe();
		if (spec.workingDir) configured = configured.cwd(spec.workingDir);
		return configured;
	});
	const stdin = await handle.takeStdin();
	if (!stdin) throw new Error('The sandbox gave no stdin for the app process');

	void (async () => {
		let exited = false;
		const finish = (code: number | null) => {
			if (exited) return;
			exited = true;
			handlers.onExit(code);
		};
		try {
			for await (const event of handle) {
				if (event.kind === 'stdout') handlers.onStdout(event.data);
				else if (event.kind === 'stderr') handlers.onStderr(event.data);
				else if (event.kind === 'exited') finish(event.code);
			}
		} catch {
			// The stream failing is the process being gone, same as it ending.
		}
		finish(null);
	})();

	return stdin;
}

// Kills the VM if the app process can't start, so a failed start leaves nothing running.
async function startMicrosandbox(
	spec: SandboxSpec,
	handlers: SandboxHandlers
): Promise<RunningSandbox> {
	const msb = await loadRuntime();
	const sandbox = await createSandbox(msb, spec);

	let stdin;
	try {
		stdin = await startProcess(sandbox, spec, handlers);
	} catch (error) {
		await sandbox.kill().catch(() => {});
		throw error;
	}

	// One message's chunks must stay contiguous on the wire, so concurrent
	// writes are queued rather than allowed to interleave.
	let queue: Promise<unknown> = Promise.resolve();
	let stopped = false;

	return {
		write(data) {
			const next = queue.then(async () => {
				for (const chunk of chunkBytes(data)) await stdin.write(Buffer.from(chunk));
			});
			queue = next.catch(() => {});
			return next;
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			await stdin.close().catch(() => {});
			await sandbox.stop().catch(() => sandbox.kill());
		}
	};
}

// Fixed so a leftover prepare sandbox is replaced rather than accumulating.
const PREPARE_NAME = `${SANDBOX_PREFIX}prepare`;

/**
 * The only backend, used by manager.ts to start apps and through
 * defaultAppDeps for installs, updates and cleanup.
 */
export const microsandboxBackend: SandboxBackend = {
	start: startMicrosandbox,

	// Booting a throwaway sandbox is how the runtime pulls (and unpacks) an
	// image, there's no standalone pull.
	async prepare(image) {
		const msb = await loadRuntime();
		let builder = msb.Sandbox.builder(PREPARE_NAME)
			.image(image)
			.ephemeral(true)
			.replace()
			.disableNetwork();
		if (usesLocalRegistry(image)) builder = builder.registry((registry) => registry.insecure());
		const sandbox = await builder.create();
		await sandbox.stop().catch(() => sandbox.kill());
	},

	async removeImage(image) {
		const msb = await loadRuntime();
		await msb.Image.remove(image).catch(() => {});
	},

	async removeVolumes(predicate) {
		const msb = await loadRuntime();
		// The static `Volume.remove(name)`, since `.remove()` on a handle from
		// `Volume.list()` throws (it's read-only), and the catch below would
		// silently leave the volumes on disk.
		for (const volume of await msb.Volume.list()) {
			if (predicate(volume.name)) await msb.Volume.remove(volume.name).catch(() => {});
		}
	},

	async removeStale(prefix) {
		const msb = await loadRuntime();
		const { sandboxes } = await msb.Sandbox.list();
		for (const sandbox of sandboxes) {
			if (!sandbox.name.startsWith(prefix)) continue;
			await sandbox.kill().catch(() => {});
			await msb.Sandbox.remove(sandbox.name).catch(() => {});
		}
	}
};
