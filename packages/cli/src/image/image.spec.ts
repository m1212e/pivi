import { describe, expect, it } from 'vitest';
import { buildArguments, pushArguments } from './builder';
import { BUNDLE_PATH } from '../paths';
import { containerfile, containerignore, NODE_MAJOR } from './containerfile';

describe('the default Containerfile', () => {
	it('copies the bundle and runs it with node', () => {
		const file = containerfile();
		expect(file).toContain(`FROM docker.io/library/node:${NODE_MAJOR}-alpine`);
		expect(file).toContain(`COPY ${BUNDLE_PATH} /app/main.mjs`);
		const entrypoint = JSON.parse(file.match(/^ENTRYPOINT (.+)$/m)![1]!);
		expect(entrypoint[0]).toBe('node');
		expect(entrypoint.at(-1)).toBe('/app/main.mjs');
	});

	it('keeps everything but the bundle out of the build context', () => {
		expect(containerignore.split('\n').filter(Boolean)).toEqual(['*', `!${BUNDLE_PATH}`]);
	});
});

describe('buildah arguments', () => {
	it('build every platform into one manifest list, reproducibly, with the label', () => {
		const args = buildArguments({
			name: 'pivi-demo:1.0.0',
			context: '/app',
			containerfile: '/app/Containerfile',
			ignorefile: '/app/.pivi-dev/containerignore',
			platforms: [
				{ os: 'linux', architecture: 'amd64' },
				{ os: 'linux', architecture: 'arm64' }
			],
			labels: { 'dev.pivi.manifest': '{"id":"demo"}' }
		});
		expect(args.slice(0, 7)).toEqual([
			'build',
			'--platform',
			'linux/amd64,linux/arm64',
			'--manifest',
			'pivi-demo:1.0.0',
			'--timestamp',
			'0'
		]);
		expect(args).toContain('dev.pivi.manifest={"id":"demo"}');
		expect(args.slice(-3)).toEqual(['-f', '/app/Containerfile', '/app']);
	});

	it('push all platforms, with credentials and without TLS only when asked', () => {
		expect(pushArguments('n:1', 'docker://r/x:1', {})).toEqual([
			'manifest',
			'push',
			'--all',
			'n:1',
			'docker://r/x:1'
		]);
		expect(
			pushArguments('n:1', 'docker://r/x:1', {
				credentials: { username: 'u', password: 'p' },
				insecure: true
			})
		).toEqual([
			'manifest',
			'push',
			'--all',
			'--creds',
			'u:p',
			'--tls-verify=false',
			'n:1',
			'docker://r/x:1'
		]);
	});
});
