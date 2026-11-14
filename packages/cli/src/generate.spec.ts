import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appManifestSchema } from '@pivi/sdk/manifest';
import { describe, expect, it } from 'vitest';
import { generateProject, normalizeOptions, writeProject, FEATURES } from './generate';
import { checkProject } from './staticChecks';

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

	it('only generates what was asked for', () => {
		const none = generateProject(normalizeOptions({ id: 'demo', ci: 'none', agent: 'none' }));
		expect(Object.keys(none)).not.toContain('.github/workflows/publish.yml');
		expect(Object.keys(none)).not.toContain('AGENTS.md');

		const all = generateProject(normalizeOptions({ id: 'demo', ci: 'github', agent: 'claude' }));
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
