import { describe, expect, it } from 'vitest';
import type { DashboardContribution } from '#lib/plugins/dashboard';
import type { PluginScreen } from '#lib/plugins/ui';
import { sanitizeDashboard, sanitizeScreen } from './sanitize';

const allows = (url: string) => url.startsWith('https://img.example.com/');

describe('sanitizeDashboard', () => {
	it('blanks images the host would not let the plugin reach, keeping the card', () => {
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
});

describe('sanitizeScreen', () => {
	it('reaches images nested in containers and lists', () => {
		const screen: PluginScreen = {
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
		const root = sanitizeScreen(screen, allows).root;
		const json = JSON.stringify(root);
		expect(json).toContain('https://img.example.com/ok.png');
		expect(json).not.toContain('evil.example.net');
		expect(json).not.toContain('data:image');
		expect(json).toContain('untouched');
	});
});
