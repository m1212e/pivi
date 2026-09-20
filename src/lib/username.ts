// Mirrors better-auth's username plugin defaults (#lib/server/auth.ts uses no
// custom validator/min/max, so these are its built-in rules) so the register
// form can reject an invalid username before ever hitting the server.
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
