import * as m from '#lib/paraglide/messages';
import { usernameIssue, type UsernameIssue } from './usernameRules';

const MESSAGES: Record<UsernameIssue, () => string> = {
	too_short: m.username_too_short,
	too_long: m.username_too_long,
	invalid_chars: m.username_invalid_chars
};

export function usernameError(username: string): string | undefined {
	const issue = usernameIssue(username);
	return issue ? MESSAGES[issue]() : undefined;
}
