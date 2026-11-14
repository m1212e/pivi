// A fake pivi host. It starts an app the way the host does (stdin/stdout
// JSON-RPC, outbound traffic through the manifest's network rules), validates
// every message in both directions against the SDK schemas and remembers what
// the app published, so a person, a test or an AI agent can drive it.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { DashboardContribution } from '@pivi/sdk/dashboard';
import { domainsAllow, type AppManifest } from '@pivi/sdk/manifest';
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOLS } from '@pivi/sdk/protocol';
import { protocolMethods, type MethodSpec } from '@pivi/sdk/schema';
import type { UiNode } from '@pivi/sdk/ui';
import { readManifest } from './project';
import { startProxy, type Proxy } from './proxy';

export type Problem = { message: string };
export type HarnessOptions = {
	dir: string;
	/** The entry file, relative to `dir`. */
	entry?: string;
	/** The command that runs a file. The images run bun. */
	runtime?: string[];
	locale?: string;
	/** Refuse connections outside the manifest, as the sandbox does. */
	enforceNetwork?: boolean;
	/** Called for everything notable, for display. */
	onEvent?: (line: string) => void;
};

type Pending = {
	spec: MethodSpec | undefined;
	resolve: (value: Reply) => void;
	timer: NodeJS.Timeout;
};
export type Reply = { result?: unknown; error?: { code: number; message: string }; valid: boolean };

const REQUEST_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 15_000;

const bySpec = (from: 'app' | 'host') => (method: string) =>
	protocolMethods.find((m) => m.from === from && m.method === method);
const appMethod = bySpec('app');
const hostMethod = bySpec('host');

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

	/** Where the app's /storage is during development, since the real one only exists in the sandbox. */
	get storageDir() {
		return join(this.dir, '.pivi-dev', 'storage');
	}

	/** Where the app's /cache is during development. */
	get cacheDir() {
		return join(this.dir, '.pivi-dev', 'cache');
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

	async start() {
		this.proxy ??= await startProxy(this.allowsHost);
		// Like the sandbox, which mounts a volume only for a granted permission: without it the
		// app is pointed at a directory that does not exist, so hasStorage() and hasCache() tell
		// the truth. Nothing is deleted, the dev data survives toggling a permission.
		const { permissions } = this.manifest;
		const volume = (granted: boolean, dir: string) => {
			if (!granted) return join(this.dir, '.pivi-dev', 'not-granted', basename(dir));
			mkdirSync(dir, { recursive: true });
			return dir;
		};
		const storageEnv = volume(permissions.includes('storage'), this.storageDir);
		const cacheEnv = volume(permissions.includes('cache'), this.cacheDir);
		this.activated = false;
		const proxyUrl = `http://127.0.0.1:${this.proxy.port}`;
		const [command, ...args] = this.options.runtime ?? ['bun', 'run'];
		const entry = join(this.dir, this.options.entry ?? 'main.ts');
		const child = spawn(command, [...args, entry], {
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
				PIVI_STORAGE_DIR: storageEnv,
				PIVI_CACHE_DIR: cacheEnv
			}
		});
		this.child = child;
		child.on('error', (error) => this.problem(`could not start the app: ${error.message}`));
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

		const readyPromise = new Promise<void>((done, fail) => {
			this.ready = done;
			setTimeout(
				() => fail(new Error(`no app/ready within ${READY_TIMEOUT_MS / 1000}s`)),
				READY_TIMEOUT_MS
			).unref();
			child.once('exit', () => fail(new Error('the app exited before it was ready')));
		});
		await readyPromise;
		this.activated = true;
		this.notify('host/activate', { locale: this.options.locale ?? 'en-US' });
	}

	private onLine(line: string) {
		if (!line.trim()) return;
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
		if (method === 'app/ready') return this.onReady(params);
		const data = this.accept(method, params, id);
		if (data) this.apply(method, data);
	}

	private onReady(params: unknown) {
		const protocol = (params as { protocol?: number } | undefined)?.protocol;
		if (protocol === undefined || !SUPPORTED_PROTOCOLS.includes(protocol)) {
			this.problem(
				`app/ready: protocol ${protocol} is not supported (host speaks ${PROTOCOL_VERSION})`
			);
		}
		this.ready?.();
	}

	/** Why the host would refuse this message, if it would. */
	private refusal(spec: MethodSpec | undefined, id: unknown): string | undefined {
		if (id !== undefined) return 'the app sent a request, the protocol has none';
		if (!spec) return 'not a method an app may send';
		if (spec.feature && !this.manifest.features.includes(spec.feature)) {
			return `the host drops this, the manifest does not declare "${spec.feature}"`;
		}
		if (!this.activated) return 'sent before host/activate, the host drops it';
		return undefined;
	}

	/** The message's validated params, or undefined (and a problem) when the host would refuse it. */
	private accept(
		method: string,
		params: unknown,
		id: unknown
	): Record<string, unknown> | undefined {
		const spec = appMethod(method);
		const refusal = this.refusal(spec, id);
		if (refusal) {
			this.problem(`${method}: ${refusal}`);
			return undefined;
		}
		const parsed = spec?.params?.safeParse(params);
		if (parsed && !parsed.success) {
			const issues = parsed.error.issues
				.slice(0, 4)
				.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
			this.problem(`${method}: the host rejects this: ${issues.join('; ')}`);
			return undefined;
		}
		return (parsed?.data ?? {}) as Record<string, unknown>;
	}

	/** Remembers what an accepted message published. */
	private apply(method: string, data: Record<string, unknown>) {
		switch (method) {
			case 'app/publishDashboard':
				this.dashboard.current = data as unknown as DashboardContribution;
				this.emit(`← dashboard: ${this.dashboard.current.cards.length} cards`);
				break;
			case 'app/publishScreen':
				this.screens.set(String(data.screenId), data.root as UiNode);
				this.emit(`← screen "${String(data.screenId)}"`);
				break;
			case 'app/openOnPhone': {
				const url = String(data.url);
				this.phoneUrls.push(url);
				this.emit(`← open on phone: ${url}`);
				if (!url.startsWith('https://')) this.problem('app/openOnPhone: the url must be https');
				break;
			}
			case 'app/chatMessages':
				this.chat.push(data);
				this.emit('← chat messages');
				break;
		}
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
		const parsed = pending.spec?.result?.safeParse(message.result);
		if (parsed && !parsed.success) {
			const issues = parsed.error.issues
				.slice(0, 4)
				.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
			this.problem(`${pending.spec?.method}: the host rejects this answer: ${issues.join('; ')}`);
			pending.resolve({ result: message.result, valid: false });
			return;
		}
		pending.resolve({ result: message.result, valid: true });
	}

	private send(message: object) {
		this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
	}

	/** Sends a host → app notification, validated like the host would build it. */
	notify(method: string, params?: unknown) {
		const spec = hostMethod(method);
		if (!spec) return this.problem(`${method}: not a method a host sends`);
		if (spec.feature && !this.manifest.features.includes(spec.feature)) {
			return this.problem(
				`${method}: the host never sends this, "${spec.feature}" is not declared`
			);
		}
		const parsed = spec.params?.safeParse(params);
		if (parsed && !parsed.success)
			return this.problem(`${method}: bad params: ${parsed.error.issues[0]?.message}`);
		this.send({ method, params });
	}

	/** Sends a host → app request and waits for the answer, which is validated. */
	request(method: string, params?: unknown): Promise<Reply> {
		const spec = hostMethod(method);
		if (!spec || spec.kind !== 'request') {
			return Promise.resolve({
				error: { code: -1, message: `${method} is not a host request` },
				valid: false
			});
		}
		if (spec.feature && !this.manifest.features.includes(spec.feature)) {
			return Promise.resolve({
				error: {
					code: -1,
					message: `the host never sends ${method}: "${spec.feature}" is not declared`
				},
				valid: false
			});
		}
		const parsed = spec.params?.safeParse(params);
		if (parsed && !parsed.success) {
			return Promise.resolve({
				error: { code: -1, message: `bad params: ${parsed.error.issues[0]?.message}` },
				valid: false
			});
		}
		const id = this.nextId++;
		return new Promise((resolveReply) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.problem(
					`${method}: no answer within ${REQUEST_TIMEOUT_MS / 1000}s, the host would kill the app`
				);
				resolveReply({ error: { code: -1, message: 'timed out' }, valid: false });
			}, REQUEST_TIMEOUT_MS);
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
		if (child && child.exitCode === null) {
			this.send({ method: 'host/shutdown' });
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
		this.phoneUrls.length = 0;
		this.chat.length = 0;
	}
}
