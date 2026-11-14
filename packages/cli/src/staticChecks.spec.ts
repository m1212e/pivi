import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './staticChecks';

const fixture = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

describe('checkProject', () => {
	it('reports an invalid manifest as an error', () => {
		const dir = mkdtempSync(join(tmpdir(), 'pivi-cli-'));
		writeFileSync(
			join(dir, 'manifest.json'),
			JSON.stringify({ id: 'Bad Id', permissions: ['network'] })
		);
		const findings = checkProject(dir);
		expect(findings.every((f) => f.level === 'error')).toBe(true);
		expect(findings.map((f) => f.message).join('\n')).toMatch(/id:/);
	});

	it('warns about declared features without code and code without features', () => {
		const messages = checkProject(fixture('bad'))
			.map((f) => f.message)
			.join('\n');
		expect(messages).toMatch(/code for "screen" was found but the manifest does not declare it/);
		expect(messages).toMatch(/blocked\.example\.org|https:\/\/blocked/);
	});

	it('passes a clean app', () => {
		const errors = checkProject(fixture('good')).filter((f) => f.level === 'error');
		expect(errors).toEqual([]);
	});
});
