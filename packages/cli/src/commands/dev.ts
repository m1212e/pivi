import { watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { executeCommand } from '../commands';
import { Harness } from '../harness';

export type DevOptions = {
	entry?: string;
	exec: string[];
	watch?: boolean;
	enforce?: boolean;
	locale?: string;
	conditions?: string[];
	/** Serve a visual preview of the published screens on this port (0: any free one). */
	preview?: number;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function createHarness(dir: string, options: DevOptions): Harness | undefined {
	try {
		return new Harness({
			dir,
			entry: options.entry,
			locale: options.locale,
			conditions: options.conditions,
			enforceNetwork: options.enforce,
			onEvent: (line) => console.log(line)
		});
	} catch (error) {
		console.error(message(error));
		return undefined;
	}
}

function printHeader(harness: Harness, enforce: boolean | undefined) {
	const { manifest } = harness;
	console.log(
		`${manifest.name} ${manifest.version}  features: ${manifest.features.join(', ') || 'none'}`
	);
	const domains = manifest.network?.domains.join(', ') ?? '(nothing, no network permission)';
	console.log(enforce === false ? 'network: NOT enforced' : `network: only ${domains}, https only`);
}

/** Runs the commands once. Blocked connections and anything the host would reject fail the run. */
async function runOnce(harness: Harness, commands: string[]): Promise<number> {
	for (const command of commands) {
		console.log(`\n> ${command}`);
		console.log(await executeCommand(harness, command));
	}
	for (const c of harness.proxy?.connections.values() ?? []) {
		if (!c.allowed)
			harness.problem(`blocked connection to ${c.host}:${c.port}, not in network.domains`);
	}
	const failed = harness.problems.length > 0;
	console.log(failed ? `\n✗ ${harness.problems.length} problem(s)` : '\n✓ no problems');
	await harness.close();
	return failed ? 1 : 0;
}

/** Restarts the app when its sources change. */
function watchSources(harness: Harness, dir: string) {
	let timer: NodeJS.Timeout | undefined;
	let restarting = false;
	const restart = async (file: string) => {
		if (restarting) return;
		restarting = true;
		console.log(`\n↻ ${file} changed, restarting`);
		await harness.stop();
		harness.reset();
		await harness.start().catch((error) => console.error(`✗ ${message(error)}`));
		restarting = false;
	};
	watch(dir, { recursive: true }, (_event, file) => {
		if (!file || /node_modules|\.pivi-dev|\.git/.test(file) || !/\.(ts|js|json)$/.test(file))
			return;
		clearTimeout(timer);
		timer = setTimeout(() => void restart(file), 300);
	});
}

function repl(harness: Harness): Promise<number> {
	console.log('\nType help for commands.\n');
	const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'pivi> ' });
	rl.prompt();
	return new Promise<number>((done) => {
		rl.on('line', async (line) => {
			if (/^(quit|exit|q)$/.test(line.trim())) return rl.close();
			const out = await executeCommand(harness, line).catch((error) => `error: ${message(error)}`);
			if (out) console.log(out);
			rl.prompt();
		});
		rl.on('close', async () => {
			await harness.close();
			done(0);
		});
	});
}

export async function dev(dir: string, options: DevOptions): Promise<number> {
	const harness = createHarness(dir, options);
	if (!harness) return 1;
	printHeader(harness, options.enforce);
	try {
		await harness.start();
	} catch (error) {
		console.error(`✗ ${message(error)}`);
		await harness.close();
		return 1;
	}
	await harness.settle(2000);

	if (options.exec.length > 0) return runOnce(harness, options.exec);
	if (options.watch) watchSources(harness, dir);
	if (options.preview !== undefined) {
		const { startPreview } = await import('../preview');
		const preview = await startPreview(harness, options.preview);
		console.log(`Preview: ${preview.url}`);
	}
	return repl(harness);
}
