import * as m from '#lib/paraglide/messages';

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function usernameError(username: string): string | undefined {
	if (username.length < 2) return m.username_too_short();
	if (username.length > 20) return m.username_too_long();
	if (!USERNAME_PATTERN.test(username)) return m.username_invalid_chars();
	return undefined;
}
