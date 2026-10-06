import * as m from '#lib/paraglide/messages';
import { usernameIssue, type UsernameIssue } from './usernameRules';

// The server reports the same issues in plain English (api/validation.ts)
const MESSAGES: Record<UsernameIssue, () => string> = {
	too_short: m.username_too_short,
	too_long: m.username_too_long,
	invalid_chars: m.username_invalid_chars
};

/**
 * Lets the register page reject a bad name before submitting, in the user's
 * language. Undefined when the name is valid.
 */
export function usernameError(username: string): string | undefined {
	const issue = usernameIssue(username);
	return issue ? MESSAGES[issue]() : undefined;
}
