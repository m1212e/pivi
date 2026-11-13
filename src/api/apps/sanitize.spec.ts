import { describe, expect, it } from 'vitest';
import type { DashboardContribution } from '#sdk/dashboard';
import type { AppScreen } from '#sdk/ui';
import { MAX_SCREEN_NODES, sanitizeDashboard, sanitizeScreen } from './sanitize';

const allows = (url: string) => url.startsWith('https://img.example.com/');

describe('sanitizeDashboard', () => {
	it('blanks images the host would not let the app reach, keeping the card', () => {
		const dashboard: DashboardContribution = {
			cards: [
				{
					kind: 'suggestion',
					id: 'a',
					title: 'A',
					meta: 'm',
					image: 'https://img.example.com/a.jpg',
					action: { type: 'session', sessionId: 'a' }
				},
				{
					kind: 'suggestion',
					id: 'b',
					title: 'B',
					meta: 'm',
					image: 'http://192.168.1.1/pixel.gif',
					action: { type: 'session', sessionId: 'b' }
				}
			]
		};
		const result = sanitizeDashboard(dashboard, allows);
		expect(result.cards.map((c) => c.image)).toEqual(['https://img.example.com/a.jpg', '']);
		expect(result.cards.map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('drops a card whose phone link is not https', () => {
		const result = sanitizeDashboard(
			{
				cards: [
					{
						kind: 'suggestion',
						id: 'a',
						title: 'A',
						meta: 'm',
						image: '',
						action: { type: 'openOnPhone', url: 'javascript:alert(1)' }
					}
				]
			},
			allows
		);
		expect(result.cards).toEqual([]);
	});
});

describe('sanitizeScreen', () => {
	it('reaches images nested in containers and lists', () => {
		const screen: AppScreen = {
			screenId: 's',
			root: {
				type: 'container',
				direction: 'column',
				children: [
					{ type: 'image', src: 'data:image/png;base64,AAAA' },
					{
						type: 'list',
						items: [
							{
								type: 'container',
								direction: 'row',
								children: [{ type: 'image', src: 'https://img.example.com/ok.png' }]
							},
							{ type: 'image', src: 'https://evil.example.net/track.png' }
						]
					},
					{ type: 'text', value: 'untouched' }
				]
			}
		};
		const root = sanitizeScreen(screen, allows)?.root;
		const json = JSON.stringify(root);
		expect(json).toContain('https://img.example.com/ok.png');
		expect(json).not.toContain('evil.example.net');
		expect(json).not.toContain('data:image');
		expect(json).toContain('untouched');
	});

	it('reaches media cards, heroes and shelves too', () => {
		const screen: AppScreen = {
			screenId: 's',
			root: {
				type: 'shelf',
				title: 'Row',
				children: [
					{ type: 'mediaCard', title: 't', meta: 'm', image: 'http://10.0.0.1/a.png' },
					{
						type: 'hero',
						title: 't',
						description: 'd',
						image: 'https://evil.example.net/b.png',
						action: { type: 'session', sessionId: 'x' }
					}
				]
			}
		};
		const json = JSON.stringify(sanitizeScreen(screen, allows));
		expect(json).not.toContain('10.0.0.1');
		expect(json).not.toContain('evil.example.net');
		expect(json).toContain('"sessionId":"x"');
	});

	it('removes unsafe phone links but keeps the node', () => {
		const screen: AppScreen = {
			screenId: 's',
			root: {
				type: 'button',
				label: 'Sign in',
				action: { type: 'openOnPhone', url: 'intent://evil' }
			}
		};
		expect(sanitizeScreen(screen, allows)?.root).toEqual({
			type: 'button',
			label: 'Sign in',
			action: undefined
		});
	});

	it('refuses a screen with more nodes than any real one needs', () => {
		const screen: AppScreen = {
			screenId: 's',
			root: {
				type: 'list',
				items: Array.from({ length: MAX_SCREEN_NODES }, () => ({ type: 'spinner' as const }))
			}
		};
		expect(sanitizeScreen(screen, allows)).toBeUndefined();
	});
});
