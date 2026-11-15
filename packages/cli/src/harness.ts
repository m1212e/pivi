// A fake pivi host. It starts an app the way the host does (stdin/stdout
// JSON-RPC, outbound traffic through the manifest's network rules), validates
// every message in both directions against the SDK schemas, applies the host's
// limits and timeouts (@pivi/sdk/limits) and remembers what the app published,
// so a person, a test or an AI agent can drive it.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { DashboardContribution } from '@pivi/sdk/dashboard';
import {
	HOST_TIMEOUTS,
	isHttpsUrl,
	MAX_MESSAGE_BYTES,
	MAX_MESSAGES_PER_SECOND,
	MAX_SCREEN_BYTES,
	MAX_SCREEN_NODES,
	MAX_SCREENS,
	OPEN_ON_PHONE_INTERVAL_MS
} from '@pivi/sdk/limits';
import { domainsAllow, type AppManifest } from '@pivi/sdk/manifest';
import {
	activateNotification,
	chatMessagesNotification,
	openOnPhoneNotification,
	PROTOCOL_VERSION,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	readyParamsSchema,
	resolveStreamRequest,
	shutdownNotification,
	SUPPORTED_PROTOCOLS,
	type NotificationType,
	type NotificationType0,
	type RequestType,
	type RequestType0
} from '@pivi/sdk/protocol';
import { methodSpec, supportsMethod, type MethodSpec } from '@pivi/sdk/schema';
import { countUiNodes, type AppScreen, type UiNode } from '@pivi/sdk/ui';
import { bundleTo } from './bundle';
import { BUNDLE_DIR, DEV_DIR, devVolume } from './paths';
import { readManifest } from './project';
import { startProxy, type Proxy } from './proxy';

export type Problem = { message: string };
export type HarnessOptions = {
	dir: string;
	/** The entry file, relative to `dir`. */
	entry?: string;
	/** Extra export conditions for bundling, e.g. `pivi-source` inside the pivi repository. */
	conditions?: string[];
	locale?: string;
	/** Refuse connections outside the manifest, as the sandbox does. */
	enforceNetwork?: boolean;
	/** Called for everything notable, for display. */
	onEvent?: (line: string) => void;
};

export type Reply<R = unknown> = {
	result?: R;
	error?: { code: number; message: string };
	valid: boolean;
};

type Pending = { spec: MethodSpec; resolve: (value: Reply) => void; timer: NodeJS.Timeout };

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
	error.issues
		.slice(0, 4)
		.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
		.join('; ');

/** The spec of a message sent by `from`, or undefined if `from` never sends it. */
const specFrom = (from: 'app' | 'host', method: string) => {
	const spec = methodSpec(method);
	return spec?.from === from ? spec : undefined;
};

export class Harness {
	readonly manifest: AppManifest;
	readonly dashboard: { current?: DashboardContribution } = {};
	readonly screens = new Map<string, UiNode>();
	readonly phoneUrls: string[] = [];
	readonly chat: Record<string, unknown>[] = [];
	readonly problems: Problem[] = [];
	readonly logs: string[] = [];
	proxy?: Proxy;

	private child?: ChildProcess;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private activated = false;
	private ready?: () => void;
	private readonly dir: string;
	private readonly emit: (line: string) => void;
	private readonly screenBytes = new Map<string, number>();
	private lastOpenOnPhone = -Infinity;
	private rate = { second: 0, count: 0 };

	constructor(private readonly options: HarnessOptions) {
		this.dir = resolve(options.dir);
		const result = readManifest(this.dir);
		if (!result.ok) throw new Error(`manifest.json is invalid:\n  ${result.errors.join('\n  ')}`);
		this.manifest = result.manifest;
		this.emit = options.onEvent ?? (() => {});
	}

	get running() {
		return this.child !== undefined && this.child.exitCode === null;
	}

	problem(message: string) {
		this.problems.push({ message });
		this.emit(`✗ ${message}`);
	}

	private allowsHost = (host: string) =>
		this.options.enforceNetwork === false ||
		(this.manifest.permissions.includes('network') &&
			!!this.manifest.network &&
			domainsAllow(this.manifest.network.domains, host));

	/** Like the sandbox, which mounts a volume only for a granted permission. */
	private volumes() {
		// Without the permission the app is pointed at a directory that does not exist, so
		// hasStorage() and hasCache() tell the truth. Nothing is deleted, the dev data
		// survives toggling a permission.
		const volume = (granted: boolean, name: 'storage' | 'cache') => {
			if (!granted) return join(this.dir, DEV_DIR, 'not-granted', name);
			const dir = devVolume(this.dir, name);
			mkdirSync(dir, { recursive: true });
			return dir;
		};
		const { permissions } = this.manifest;
		return {
			PIVI_STORAGE_DIR: volume(permissions.includes('storage'), 'storage'),
			PIVI_CACHE_DIR: volume(permissions.includes('cache'), 'cache')
		};
	}

	/** The process to start: the app bundled with tsdown, exactly as the image gets it, on node. */
	private async command(): Promise<string[]> {
		const bundle = await bundleTo(this.dir, join(this.dir, BUNDLE_DIR), {
			entry: this.options.entry,
			conditions: this.options.conditions
		});
		return [process.execPath.endsWith('node') ? process.execPath : 'node', bundle];
	}

	async start() {
		this.proxy ??= await startProxy(this.allowsHost);
		this.activated = false;
		const proxyUrl = `http://127.0.0.1:${this.proxy.port}`;
		const [command, ...args] = await this.command();
		const child = spawn(command!, args, {
			cwd: this.dir,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				HTTP_PROXY: proxyUrl,
				HTTPS_PROXY: proxyUrl,
				http_proxy: proxyUrl,
				https_proxy: proxyUrl,
				NO_PROXY: '',
				no_proxy: '',
				// Node's fetch only honours the proxy variables when asked to.
				NODE_USE_ENV_PROXY: '1',
				...this.volumes()
			}
		});
		this.child = child;
		child.on('error', (error) =>
			this.problem(
				(error as NodeJS.ErrnoException).code === 'ENOENT'
					? `${command} is not installed: pivi-app dev runs the app on node`
					: `could not start the app: ${error.message}`
			)
		);
		child.on('exit', (code, signal) => {
			this.emit(`app exited (${signal ?? code})`);
			for (const [id, p] of this.pending) {
				clearTimeout(p.timer);
				p.resolve({ error: { code: -1, message: 'the app exited' }, valid: false });
				this.pending.delete(id);
			}
		});
		createInterface({ input: child.stderr! }).on('line', (line) => {
			this.logs.push(line);
			if (this.logs.length > 500) this.logs.shift();
			this.emit(`  ${line}`);
		});
		createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(line));

		const readyMs = HOST_TIMEOUTS.readyMs;
		await new Promise<void>((done, fail) => {
			this.ready = done;
			setTimeout(
				() => fail(new Error(`no ${readyNotification.method} within ${readyMs / 1000}s`)),
				readyMs
			).unref();
			child.once('exit', () => fail(new Error('the app exited before it was ready')));
			child.once('error', (error) =>
				fail(new Error(`could not start ${command}: ${error.message}`))
			);
		});
		this.activated = true;
		this.notify(activateNotification, { locale: this.options.locale ?? 'en-US' });
	}

	/** The host's limits on what arrives at all: message size and rate. */
	private withinLimits(line: string): boolean {
		if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
			this.problem(`a message over ${MAX_MESSAGE_BYTES} bytes, the host drops it`);
			return false;
		}
		const second = Math.floor(Date.now() / 1000);
		this.rate =
			this.rate.second === second ? { second, count: this.rate.count + 1 } : { second, count: 1 };
		if (this.rate.count === MAX_MESSAGES_PER_SECOND + 1) {
			this.problem(`over ${MAX_MESSAGES_PER_SECOND} messages in a second, the host stops reading`);
		}
		return true;
	}

	private onLine(line: string) {
		if (!line.trim() || !this.withinLimits(line)) return;
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(line);
		} catch {
			this.problem(`stdout is not JSON, which corrupts the protocol: ${line.slice(0, 120)}`);
			return;
		}
		if (typeof message.method === 'string')
			this.onAppMessage(message.method, message.params, message.id);
		else if (typeof message.id === 'number') this.onReply(message);
		else this.problem(`unrecognized message: ${line.slice(0, 120)}`);
	}

	private onAppMessage(method: string, params: unknown, id: unknown) {
		if (method === readyNotification.method) return this.onReady(params);
		const data = this.accept(method, params, id);
		if (data !== undefined) this.apply(method, data);
	}

	private onReady(params: unknown) {
		const parsed = readyParamsSchema.safeParse(params);
		if (!parsed.success || !SUPPORTED_PROTOCOLS.includes(parsed.data.protocol)) {
			this.problem(
				`${readyNotification.method}: protocol ${parsed.data?.protocol} is not supported (host speaks ${PROTOCOL_VERSION})`
			);
		}
		this.ready?.();
	}

	/** Why the host would refuse this message, if it would. */
	private refusal(spec: MethodSpec | undefined, id: unknown): string | undefined {
		if (id !== undefined) return 'the app sent a request, the protocol has none';
		if (!spec) return 'not a method an app may send';
		if (!supportsMethod(this.manifest.features, spec)) {
			return `the host drops this, the manifest does not declare "${spec.feature}"`;
		}
		if (!this.activated) return `sent before ${activateNotification.method}, the host drops it`;
		return undefined;
	}

	/** The message's validated params, or undefined (and a problem) when the host would refuse it. */
	private accept(method: string, params: unknown, id: unknown): unknown {
		const spec = specFrom('app', method);
		const refusal = this.refusal(spec, id);
		if (refusal) {
			this.problem(`${method}: ${refusal}`);
			return undefined;
		}
		const parsed = spec?.params?.safeParse(params);
		if (parsed && !parsed.success) {
			this.problem(`${method}: the host rejects this: ${issuesOf(parsed.error)}`);
			return undefined;
		}
		return parsed?.data ?? {};
	}

	/** Remembers what an accepted message published, within the host's limits. */
	private apply(method: string, data: unknown) {
		switch (method) {
			case publishDashboardNotification.method: {
				this.dashboard.current = data as DashboardContribution;
				this.emit(`← dashboard: ${this.dashboard.current.cards.length} cards`);
				break;
			}
			case publishScreenNotification.method:
				this.applyScreen(data as AppScreen);
				break;
			case openOnPhoneNotification.method:
				this.applyOpenOnPhone((data as { url: string }).url);
				break;
			case chatMessagesNotification.method:
				this.chat.push(data as Record<string, unknown>);
				this.emit('← chat messages');
				break;
		}
	}

	private applyScreen(screen: AppScreen) {
		const method = publishScreenNotification.method;
		if (countUiNodes(screen.root) > MAX_SCREEN_NODES) {
			return this.problem(`${method}: over ${MAX_SCREEN_NODES} nodes, the host drops it`);
		}
		if (!this.screens.has(screen.screenId) && this.screens.size >= MAX_SCREENS) {
			return this.problem(`${method}: over ${MAX_SCREENS} screens, the host drops new ones`);
		}
		const bytes = Buffer.byteLength(JSON.stringify(screen));
		const others = [...this.screenBytes].reduce(
			(sum, [id, size]) => (id === screen.screenId ? sum : sum + size),
			0
		);
		if (others + bytes > MAX_SCREEN_BYTES) {
			return this.problem(
				`${method}: all screens over ${MAX_SCREEN_BYTES} bytes, the host drops it`
			);
		}
		this.screens.set(screen.screenId, screen.root);
		this.screenBytes.set(screen.screenId, bytes);
		this.emit(`← screen "${screen.screenId}"`);
	}

	private applyOpenOnPhone(url: string) {
		const method = openOnPhoneNotification.method;
		if (!isHttpsUrl(url)) return this.problem(`${method}: the url must be https`);
		if (Date.now() - this.lastOpenOnPhone < OPEN_ON_PHONE_INTERVAL_MS) {
			return this.problem(
				`${method}: more than one per ${OPEN_ON_PHONE_INTERVAL_MS / 1000}s, the host drops it`
			);
		}
		this.lastOpenOnPhone = Date.now();
		this.phoneUrls.push(url);
		this.emit(`← open on phone: ${url}`);
	}

	private onReply(message: Record<string, unknown>) {
		const pending = this.pending.get(message.id as number);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(message.id as number);
		if (message.error) {
			pending.resolve({ error: message.error as Reply['error'], valid: true });
			return;
		}
		const parsed = pending.spec.result?.safeParse(message.result);
		if (parsed && !parsed.success) {
			this.problem(
				`${pending.spec.method}: the host rejects this answer: ${issuesOf(parsed.error)}`
			);
			pending.resolve({ result: message.result, valid: false });
			return;
		}
		pending.resolve({ result: message.result, valid: true });
	}

	private send(message: object) {
		this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
	}

	/** Sends a host → app notification, typed by the SDK's notification type. */
	notify<P>(type: NotificationType<P>, params: P): void;
	notify(type: NotificationType0): void;
	notify(type: { method: string }, params?: unknown): void {
		this.notifyByName(type.method, params);
	}

	/** The same by method name, for what a person types (`send`). Validated like the host would build it. */
	notifyByName(method: string, params?: unknown) {
		const spec = specFrom('host', method);
		if (!spec || spec.kind !== 'notification')
			return this.problem(`${method}: not a notification a host sends`);
		if (!supportsMethod(this.manifest.features, spec)) {
			return this.problem(
				`${method}: the host never sends this, "${spec.feature}" is not declared`
			);
		}
		const parsed = spec.params?.safeParse(params);
		if (parsed && !parsed.success)
			return this.problem(`${method}: bad params: ${issuesOf(parsed.error)}`);
		this.send({ method, params });
	}

	/** Sends a host → app request and waits for the validated answer, typed by the SDK's request type. */
	request<P, R>(type: RequestType<P, R, void>, params: P): Promise<Reply<R>>;
	request<R>(type: RequestType0<R, void>): Promise<Reply<R>>;
	request(type: { method: string }, params?: unknown): Promise<Reply> {
		return this.requestByName(type.method, params);
	}

	/** The same by method name, for what a person types (`call`). */
	requestByName(method: string, params?: unknown): Promise<Reply> {
		const failed = (message: string): Promise<Reply> =>
			Promise.resolve({ error: { code: -1, message }, valid: false });
		const spec = specFrom('host', method);
		if (!spec || spec.kind !== 'request') return failed(`${method} is not a request a host sends`);
		if (!supportsMethod(this.manifest.features, spec)) {
			return failed(`the host never sends ${method}: "${spec.feature}" is not declared`);
		}
		const parsed = spec.params?.safeParse(params);
		if (parsed && !parsed.success) return failed(`bad params: ${issuesOf(parsed.error)}`);

		const timeout =
			method === resolveStreamRequest.method
				? HOST_TIMEOUTS.resolveStreamMs
				: HOST_TIMEOUTS.requestMs;
		const id = this.nextId++;
		return new Promise((resolveReply) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.problem(`${method}: no answer within ${timeout / 1000}s, the host would stop the app`);
				resolveReply({ error: { code: -1, message: 'timed out' }, valid: false });
			}, timeout);
			timer.unref();
			this.pending.set(id, { spec, resolve: resolveReply, timer });
			this.send({ id, method, params });
		});
	}

	/** Waits until the app has published something, or the time is up. */
	async settle(ms = 1500) {
		await new Promise((done) => setTimeout(done, ms));
	}

	async stop() {
		const child = this.child;
		// A process that never started (node is missing) has no pid and never exits.
		if (child && child.exitCode === null && child.pid !== undefined) {
			this.send({ method: shutdownNotification.method });
			child.stdin?.end();
			await new Promise<void>((done) => {
				const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
				child.once('exit', () => {
					clearTimeout(kill);
					done();
				});
			});
		}
		this.child = undefined;
	}

	async close() {
		await this.stop();
		await this.proxy?.close();
		this.proxy = undefined;
	}

	/** Forgets what the app published, for a restart. */
	reset() {
		this.dashboard.current = undefined;
		this.screens.clear();
		this.screenBytes.clear();
		this.phoneUrls.length = 0;
		this.chat.length = 0;
		this.lastOpenOnPhone = -Infinity;
	}
}
