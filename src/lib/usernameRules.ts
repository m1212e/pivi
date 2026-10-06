// The one definition of a valid username. The register form maps issues to
// translated messages, the server to plain English ones.

const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 20;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type UsernameIssue = 'too_short' | 'too_long' | 'invalid_chars';

/** Expects an already trimmed name. */
export function usernameIssue(username: string): UsernameIssue | undefined {
	if (username.length < USERNAME_MIN_LENGTH) return 'too_short';
	if (username.length > USERNAME_MAX_LENGTH) return 'too_long';
	if (!USERNAME_PATTERN.test(username)) return 'invalid_chars';
	return undefined;
}
