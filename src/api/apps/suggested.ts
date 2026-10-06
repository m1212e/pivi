/**
 * An app offered in the install form (AppManagerPanel.svelte) so the user can
 * tap it instead of typing an image ref on a TV remote. `icon` copies the app's
 * manifest icon since nothing is pulled yet to read it from, so keep the two in sync.
 */
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

/** Served by the suggestedApps GraphQL query (handlers/appManagement.ts). */
export function suggestedApps(): SuggestedApp[] {
	return SUGGESTED_APPS;
}
