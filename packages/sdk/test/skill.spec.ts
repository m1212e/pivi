import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderProtocolReference } from '../scripts/skillReference';
import { buildProtocolDocument } from '../src/schema';

const skillDir = new URL('../skills/pivi-app/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, skillDir), 'utf8');

describe('the pivi-app skill', () => {
	it('has a committed protocol reference that matches the schemas', () => {
		// Fails after a protocol change: run `bun run skill` in packages/sdk.
		expect(read('references/protocol.md')).toBe(renderProtocolReference());
	});

	it('documents every method of the protocol', () => {
		const reference = read('references/protocol.md');
		for (const { method } of buildProtocolDocument().methods) {
			expect(reference).toContain(`### \`${method}\``);
		}
	});

	it('has the frontmatter a skill needs', () => {
		const match = read('SKILL.md').match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
		expect(match?.[1]).toBe('pivi-app');
		expect(match?.[2].length).toBeGreaterThan(40);
	});

	it('only points at files that exist in the package', () => {
		const skill = read('SKILL.md');
		const root = new URL('../', import.meta.url);
		for (const [, path] of skill.matchAll(/`((?:src|skills)\/[\w./-]+\.(?:ts|md))`/g)) {
			expect(existsSync(new URL(path, root)), path).toBe(true);
		}
	});

	it('names the protocol version it was written for', () => {
		const { protocol } = buildProtocolDocument();
		expect(read('SKILL.md')).toContain(`"protocol": ${protocol}`);
	});
});
