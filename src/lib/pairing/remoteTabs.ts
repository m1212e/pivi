/** The input surfaces the phone remote page switches between, one component per tab. */
export type RemoteTab = 'pin' | 'keyboard' | 'profiles' | 'player' | 'trackpad';

/** The slice of the TV's pushed state that picks the tab, narrow so the rule is testable on its own. */
export type TabInputs = {
	hasPinPad: boolean;
	hasTextInput: boolean;
	profiles: readonly unknown[];
	hasPlayer: boolean;
};

/**
 * The tab the phone surfaces for the TV's current screen, so nobody has to
 * pick one by hand. Earlier entries win when several apply at once.
 */
export function requiredTabFor(tv: TabInputs): RemoteTab {
	if (tv.hasPinPad) return 'pin';
	if (tv.hasTextInput) return 'keyboard';
	if (tv.profiles.length > 0) return 'profiles';
	if (tv.hasPlayer) return 'player';
	return 'trackpad';
}
