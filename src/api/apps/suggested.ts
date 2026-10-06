// Known apps offered in the install form so a user can tap one instead of
// typing out an image ref. `icon` is the same inline SVG the app's own
// manifest carries (manifest.ts's `icon`) -- duplicated here because this list
// is shown before anything is installed or even pulled, so there's no
// manifest yet to read it from. Keep it in sync with the app's actual
// manifest.json so the suggestion and the installed app look the same.
export type SuggestedApp = {
	id: string;
	name: string;
	description: string;
	icon: string | null;
	image: string;
	publicKey?: string;
};

const SUGGESTED_APPS: SuggestedApp[] = [
	{
		id: 'youtube',
		name: 'YouTube',
		description: 'Browse and watch YouTube on the TV',
		icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#FF0000"/><path d="M20 16L32 24L20 32Z" fill="#FFFFFF"/></svg>',
		image: 'localhost:5055/pivi-youtube'
	}
];

export function suggestedApps(): SuggestedApp[] {
	return SUGGESTED_APPS;
}
