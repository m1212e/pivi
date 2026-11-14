import { watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { executeCommand, HELP } from '../commands';
import { Harness } from '../harness';

export type DevOptions = {
	entry?: string;
	exec: string[];
	watch?: boolean;
	enforce?: boolean;
	locale?: string;
	runtime?: string[];
};

export async function dev(dir: string, options: DevOptions): Promise<number> {
	let harness: Harness;
	try {
		harness = new Harness({
			dir,
			entry: options.entry,
			locale: options.locale,
			runtime: options.runtime,
			enforceNetwork: options.enforce,
			onEvent: (line) => console.log(line)
		});
	} catch (error) {
		console.error(String(error instanceof Error ? error.message : error));
		return 1;
	}
	const { manifest } = harness;
	console.log(
		`${manifest.name} ${manifest.version}  features: ${manifest.features.join(', ') || 'none'}`
	);
	console.log(
		options.enforce === false
			? 'network: NOT enforced'
			: `network: only ${manifest.network?.domains.join(', ') ?? '(nothing, no network permission)'}, https only`
	);
	try {
		await harness.start();
	} catch (error) {
		console.error(`✗ ${error instanceof Error ? error.message : error}`);
		await harness.close();
		return 1;
	}
	await harness.settle(2000);

	if (options.exec.length > 0) {
		for (const command of options.exec) {
			console.log(`\n> ${command}`);
			console.log(await executeCommand(harness, command));
		}
		const blocked = [...(harness.proxy?.connections.values() ?? [])].filter((c) => !c.allowed);
		for (const c of blocked)
			harness.problem(`blocked connection to ${c.host}:${c.port}, not in network.domains`);
		const failed = harness.problems.length > 0;
		console.log(failed ? `\n✗ ${harness.problems.length} problem(s)` : '\n✓ no problems');
		await harness.close();
		return failed ? 1 : 0;
	}

	console.log('\nType help for commands.\n');
	let restarting = false;
	if (options.watch) {
		let timer: NodeJS.Timeout | undefined;
		watch(process.cwd() === dir ? '.' : dir, { recursive: true }, (_event, file) => {
			if (!file || /node_modules|\.pivi-dev|\.git/.test(file) || !/\.(ts|js|json)$/.test(file))
				return;
			clearTimeout(timer);
			timer = setTimeout(async () => {
				if (restarting) return;
				restarting = true;
				console.log(`\n↻ ${file} changed, restarting`);
				await harness.stop();
				harness.reset();
				try {
					await harness.start();
				} catch (error) {
					console.error(`✗ ${error instanceof Error ? error.message : error}`);
				}
				restarting = false;
			}, 300);
		});
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'pivi> ' });
	rl.prompt();
	return new Promise<number>((done) => {
		rl.on('line', async (line) => {
			if (/^(quit|exit|q)$/.test(line.trim())) return rl.close();
			try {
				const out = await executeCommand(harness, line);
				if (out) console.log(out);
			} catch (error) {
				console.log(`error: ${error instanceof Error ? error.message : error}`);
			}
			rl.prompt();
		});
		rl.on('close', async () => {
			await harness.close();
			done(0);
		});
	});
}

export { HELP };
