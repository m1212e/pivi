// Builds and pushes app images with buildah (daemonless, rootless), or podman,
// which is buildah underneath and takes the same options. Multi-platform
// images come out as one manifest list; a Containerfile without RUN steps needs
// no emulation for that, one with RUN steps needs QEMU (binfmt) for the other
// architecture, as with any container build tool.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalRegistry, type ImageRef } from '@pivi/sdk/image';

export type Tool = 'buildah' | 'podman';
export type Platform = { os: 'linux'; architecture: 'amd64' | 'arm64' };
export const DEFAULT_PLATFORMS: Platform[] = [
	{ os: 'linux', architecture: 'amd64' },
	{ os: 'linux', architecture: 'arm64' }
];

const available = (tool: string) =>
	spawnSync(tool, ['--version'], { stdio: 'ignore' }).status === 0;

/** buildah if it is installed, podman otherwise. `PIVI_BUILDER` picks one explicitly. */
export function findTool(): Tool {
	const wanted = process.env.PIVI_BUILDER;
	if (wanted === 'buildah' || wanted === 'podman') return wanted;
	if (available('buildah')) return 'buildah';
	if (available('podman')) return 'podman';
	throw new Error(
		'pivi-app builds images with buildah (or podman): install one, e.g. `apt install buildah` or `dnf install buildah`'
	);
}

function run(tool: Tool, args: string[], quiet = false) {
	// The tool's output goes to stderr: stdout is reserved (`pivi-app mcp` speaks MCP on it).
	const result = spawnSync(tool, args, { stdio: quiet ? 'ignore' : ['ignore', 2, 2] });
	if (result.error) throw new Error(`${tool} could not run: ${result.error.message}`);
	if (result.status !== 0)
		throw new Error(`${tool} ${args[0]} ${args[1] ?? ''} failed (exit ${result.status})`);
}

export type BuildArgs = {
	/** Local name of the manifest list, e.g. `pivi-twitch:0.6.0`. */
	name: string;
	context: string;
	containerfile: string;
	ignorefile?: string;
	platforms: Platform[];
	labels: Record<string, string>;
};

/** The `build` arguments. `--timestamp 0` makes the same input give the same image digest. */
export function buildArguments(args: BuildArgs): string[] {
	return [
		'build',
		'--platform',
		args.platforms.map((p) => `${p.os}/${p.architecture}`).join(','),
		'--manifest',
		args.name,
		'--timestamp',
		'0',
		...Object.entries(args.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
		...(args.ignorefile ? ['--ignorefile', args.ignorefile] : []),
		'-f',
		args.containerfile,
		args.context
	];
}

export function buildImage(tool: Tool, args: BuildArgs) {
	// A manifest list of that name from an earlier build would collect this build's images too.
	spawnSync(tool, ['manifest', 'rm', args.name], { stdio: 'ignore' });
	run(tool, buildArguments(args));
}

export type Credentials = { username: string; password: string };

/** The `manifest push` arguments for one destination (docker://… or oci:…). */
export function pushArguments(
	name: string,
	destination: string,
	options: { credentials?: Credentials; insecure?: boolean }
) {
	return [
		'manifest',
		'push',
		'--all',
		...(options.credentials
			? ['--creds', `${options.credentials.username}:${options.credentials.password}`]
			: []),
		...(options.insecure ? ['--tls-verify=false'] : []),
		name,
		destination
	];
}

/** Pushes the manifest list and every platform image to one tag, and returns the pushed digest. */
export function pushImage(
	tool: Tool,
	name: string,
	target: ImageRef,
	credentials?: Credentials
): string {
	const dir = mkdtempSync(join(tmpdir(), 'pivi-push-'));
	try {
		const digestFile = join(dir, 'digest');
		const destination = `docker://${target.registry}/${target.repository}:${target.tag}`;
		const args = pushArguments(name, destination, {
			credentials,
			insecure: isLocalRegistry(target.registry)
		});
		run(tool, [...args.slice(0, 3), '--digestfile', digestFile, ...args.slice(3)]);
		return readFileSync(digestFile, 'utf8').trim();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Writes the image as an OCI image layout directory. */
export function exportLayout(tool: Tool, name: string, dir: string) {
	run(tool, pushArguments(name, `oci:${dir}`, {}));
}
