// Shared with #api/auth-pin, which re-checks this server-side, so the
// register form's client-side rejection can't be the only enforcement.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export function usernameError(username: string): string | null {
	if (username.length < USERNAME_MIN_LENGTH)
		return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
	if (username.length > USERNAME_MAX_LENGTH)
		return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
	if (!USERNAME_PATTERN.test(username)) return 'Only letters, numbers, "_" and "." are allowed';
	return null;
}
