import { mkdtempSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appManifestSchema } from '@pivi/sdk/manifest';
import { describe, expect, it } from 'vitest';
import { generateProject, normalizeOptions, writeProject, FEATURES } from './generate';
import { checkProject } from './staticChecks';

const files = (path: string) => generateProject(normalizeOptions({ id: 'demo' }))[path]!;

describe('init', () => {
	it('refuses ids the manifest would refuse', () => {
		expect(() => normalizeOptions({ id: 'Not Valid' })).toThrow(/Invalid id/);
		expect(() => normalizeOptions({ id: 'ok', features: ['nope' as never] })).toThrow(
			/Unknown feature/
		);
	});

	// Every feature subset has to produce an app that validates, or `init` ships a broken start.
	const subsets = [[], ...FEATURES.map((f) => [f]), [...FEATURES]] as (typeof FEATURES)[number][][];
	for (const features of subsets) {
		for (const storage of [false, true]) {
			it(`generates a valid app for [${features.join(', ')}] storage=${storage}`, () => {
				const options = normalizeOptions({ id: 'demo', features, storage });
				const files = generateProject(options);
				expect(appManifestSchema.safeParse(JSON.parse(files['manifest.json']!)).success).toBe(true);

				const dir = mkdtempSync(join(tmpdir(), 'pivi-init-'));
				writeProject(dir, files);
				const errors = checkProject(dir).filter((f) => f.level === 'error');
				expect(errors).toEqual([]);
				// Declared features must have code, and no code without a declaration.
				const warnings = checkProject(dir).filter((f) =>
					/feature|manifest does not declare/.test(f.message)
				);
				expect(warnings).toEqual([]);
			});
		}
	}

	it('depends on the SDK range and CLI version of this CLI by default', () => {
		const pkg = JSON.parse(files('package.json'));
		const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		expect(pkg.dependencies['@pivi/sdk']).toBe(own.peerDependencies['@pivi/sdk']);
		expect(pkg.devDependencies['@pivi/cli']).toBe(`^${own.version}`);
	});

	it.each([
		[
			'github',
			'.github/workflows/publish.yml',
			/PIVI_REGISTRY_PASSWORD: \$\{\{ secrets\.GITHUB_TOKEN \}\}/
		],
		['gitlab', '.gitlab-ci.yml', /PIVI_REGISTRY_PASSWORD: \$CI_REGISTRY_PASSWORD/],
		[
			'gitea',
			'.gitea/workflows/publish.yml',
			/PIVI_REGISTRY_PASSWORD: \$\{\{ secrets\.REGISTRY_TOKEN \}\}/
		]
	] as const)('generates %s CI that publishes with pivi-app on a tag', (ci, path, credentials) => {
		const files = generateProject(normalizeOptions({ id: 'demo', ci }));
		const workflow = files[path]!;
		expect(workflow).toMatch(/bun run publish -- /);
		expect(workflow).toMatch(credentials);
		expect(workflow).not.toMatch(/docker build|build-push-action/);
		// Valid YAML, which the CI would otherwise only tell after a push.
		expect(() => parseYaml(workflow)).not.toThrow();
		const others = [
			'.github/workflows/publish.yml',
			'.gitlab-ci.yml',
			'.gitea/workflows/publish.yml'
		];
		for (const other of others.filter((o) => o !== path)) expect(files[other]).toBeUndefined();
	});

	it('scaffolds a Containerfile that runs the bundle on node', () => {
		const files = generateProject(normalizeOptions({ id: 'demo' }));
		expect(files.Containerfile).toMatch(/^FROM docker\.io\/library\/node:/m);
		expect(files.Containerfile).toContain('ENTRYPOINT ["node", "/app/main.mjs"]');
		expect(files['.containerignore']).toContain('!.pivi-dev/bundle/main.mjs');
	});

	it('only generates what was asked for', () => {
		const none = generateProject(normalizeOptions({ id: 'demo', ci: 'none', agent: 'none' }));
		expect(Object.keys(none)).not.toContain('.github/workflows/publish.yml');
		expect(Object.keys(none)).not.toContain('AGENTS.md');

		const all = generateProject(normalizeOptions({ id: 'demo', ci: 'github', agent: 'claude' }));
		expect(JSON.parse(all['.mcp.json']!).mcpServers.pivi.args).toEqual(['pivi-app', 'mcp']);
		expect(Object.keys(all)).toEqual(
			expect.arrayContaining([
				'AGENTS.md',
				'CLAUDE.md',
				'.claude/settings.json',
				'.github/workflows/publish.yml'
			])
		);
		expect(all['AGENTS.md']).toContain('skills/pivi-app/SKILL.md');
	});
});
