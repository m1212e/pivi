import { describe, expect, it } from 'vitest';
import { messageParts, parseIrcLine, toChatMessage, toRemoval } from './chat';

describe('Twitch chat parsing', () => {
	it('turns a tagged PRIVMSG into a chat message with emotes', () => {
		const raw =
			'@badge-info=;color=#1E90FF;display-name=Some\\sOne;emotes=25:0-4,12-16;id=abc-123 :someone!someone@someone.tmi.twitch.tv PRIVMSG #caedrel :Kappa hello Kappa';
		const line = parseIrcLine(raw)!;
		expect(toChatMessage(line)).toEqual({
			channel: 'caedrel',
			message: {
				id: 'abc-123',
				author: 'Some One',
				color: '#1E90FF',
				parts: [
					{
						type: 'emote',
						name: 'Kappa',
						url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'
					},
					{ type: 'text', text: ' hello ' },
					{
						type: 'emote',
						name: 'Kappa',
						url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'
					}
				]
			}
		});
	});

	it('counts emote positions in code points, not UTF-16 units', () => {
		expect(messageParts('😀 Kappa', '25:2-6')).toEqual([
			{ type: 'text', text: '😀 ' },
			{
				type: 'emote',
				name: 'Kappa',
				url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'
			}
		]);
	});

	it('unwraps /me actions and ignores other commands', () => {
		const action = parseIrcLine(':a!a@a.tmi.twitch.tv PRIVMSG #x :\u0001ACTION waves\u0001')!;
		expect(toChatMessage(action)?.message.parts).toEqual([{ type: 'text', text: 'waves' }]);
		expect(toChatMessage(parseIrcLine('PING :tmi.twitch.tv')!)).toBeUndefined();
	});
});

describe('Twitch moderation', () => {
	it('turns deletions, timeouts and clears into removals', () => {
		const deleted = parseIrcLine('@login=x;target-msg-id=abc :tmi.twitch.tv CLEARMSG #chan :oops')!;
		expect(toRemoval(deleted)).toEqual({ channel: 'chan', removed: { ids: ['abc'] } });
		const timeout = parseIrcLine(
			'@ban-duration=600;target-user-id=42 :tmi.twitch.tv CLEARCHAT #chan :someone'
		)!;
		expect(toRemoval(timeout)).toEqual({ channel: 'chan', removed: { authorIds: ['42'] } });
		expect(toRemoval(parseIrcLine(':tmi.twitch.tv CLEARCHAT #chan')!)).toEqual({
			channel: 'chan',
			removed: { all: true }
		});
	});

	it('takes the author id from the user-id tag', () => {
		const line = parseIrcLine('@user-id=42;id=m1 :a!a@a.tmi.twitch.tv PRIVMSG #chan :hi')!;
		expect(toChatMessage(line)?.message.authorId).toBe('42');
	});
});
