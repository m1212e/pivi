import { describe, expect, it } from 'vitest';
import { appScreenSchema } from './ui';

const withWidth = (width: string) => ({
	screenId: 's',
	root: { type: 'container', direction: 'row', children: [], width }
});

describe('appScreenSchema', () => {
	it('accepts plain CSS lengths as a width', () => {
		for (const width of ['14rem', '320px', '50%', '12.5em']) {
			expect(appScreenSchema.safeParse(withWidth(width)).success).toBe(true);
		}
	});

	it('refuses a width that carries more than a length', () => {
		for (const width of ['1px; position: fixed', 'calc(100% - 1px)', 'url(x)', '']) {
			expect(appScreenSchema.safeParse(withWidth(width)).success).toBe(false);
		}
	});
});
