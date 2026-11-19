import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Pinned by the NixOS module. Unset elsewhere, where the report just says so.
const JOURNALCTL = process.env.PIVI_JOURNALCTL;
const EGLINFO = process.env.PIVI_EGLINFO;

// What Chromium and cage (wlroots) say about how they draw.
const GRAPHICS_LOG =
	/gpu|egl|gles|angle|drm|gbm|dmabuf|renderer|vulkan|webgl|vc4|v3d|mesa|swiftshader|llvmpipe|pixman/i;
const LOG_LINES = 40;

async function read(path: string): Promise<string> {
	try {
		return (await readFile(path, 'utf8')).replaceAll('\0', '').trim();
	} catch (err) {
		return `(${(err as Error).message})`;
	}
}

async function command(file: string | undefined, args: string[]): Promise<string> {
	if (!file) return '(not available on this system)';
	try {
		const { stdout, stderr } = await run(file, args, { timeout: 10_000 });
		return (stdout + stderr).trim();
	} catch (err) {
		const {
			stdout = '',
			stderr = '',
			message
		} = err as Error & { stdout?: string; stderr?: string };
		return (stdout + stderr).trim() || `(${message})`;
	}
}

// Which kernel driver owns each display and render node. A Pi whose GPU is
// working has vc4 (Pi 3) or v3d (Pi 4/5) behind a renderD node.
async function drmNodes(): Promise<string> {
	let names: string[];
	try {
		names = (await readdir('/sys/class/drm')).filter((name) => /^(card|renderD)\d+$/.test(name));
	} catch {
		return '(no /sys/class/drm)';
	}
	const lines = await Promise.all(
		names.map(async (name) => {
			const driver = await readlink(`/sys/class/drm/${name}/device/driver`).catch(() => '?');
			return `${name}: ${driver.split('/').pop()}`;
		})
	);
	return lines.join('\n') || '(none)';
}

/** Plain text describing the device's graphics stack, for diagnosing software rendering on the TV. */
export async function graphicsReport(): Promise<string> {
	const [model, kernel, cmdline, meminfo, nodes, egl, log] = await Promise.all([
		read('/proc/device-tree/model'),
		read('/proc/sys/kernel/osrelease'),
		read('/proc/cmdline'),
		read('/proc/meminfo'),
		drmNodes(),
		command(EGLINFO, ['-B', '-p', 'gbm']),
		command(JOURNALCTL, ['-b', '-u', 'cage-tty1', '-o', 'cat', '--no-pager', '-n', '3000'])
	]);
	const memory = meminfo
		.split('\n')
		.filter((line) => /^(MemTotal|MemAvailable|CmaTotal|CmaFree)/.test(line))
		.join('\n');
	const graphicsLog = log
		.split('\n')
		.filter((line) => GRAPHICS_LOG.test(line))
		.slice(-LOG_LINES)
		.join('\n');

	return [
		['Model', model],
		['Kernel', kernel],
		['Command line', cmdline],
		['Memory', memory],
		['DRM nodes', nodes],
		['EGL (GBM)', egl],
		['Kiosk log', graphicsLog || '(no graphics related lines)']
	]
		.map(([title, body]) => `## ${title}\n${body}`)
		.join('\n\n');
}
