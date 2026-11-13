// Apps offered in the install form (AppManagerPanel.svelte) so the user can
// tap one instead of typing an image ref on a TV remote. Which ones is
// configuration (PIVI_SUGGESTED_APPS), and what each one is comes from its own
// manifest in the registry, so the host carries no details of any app.
import { PIVI_SUGGESTED_APPS } from '$app/env/private';
import { formatImageRef, parseImageRef } from '#lib/apps/imageRef';
import { resolveImage, type RegistryClient } from './registry';
import { createTtlCache } from './ttlCache';
import type { AppManifest } from '#sdk/manifest';

export type SuggestedApp = {
	id: string;
	name: string;
	description: string | null;
	icon: string | null;
	image: string;
};

// Only labels are read, but that's still a registry round trip per app, and
// the list is fetched each time /apps opens. Failures are cached too, so an
// unreachable registry doesn't slow down every visit.
const cache = createTtlCache<SuggestedApp | null>(60 * 60 * 1000);

function fromManifest(manifest: AppManifest, image: string): SuggestedApp {
	return {
		id: manifest.id,
		name: manifest.name,
		description: manifest.description ?? null,
		icon: manifest.icon ?? null,
		image
	};
}

async function describe(image: string, registry: RegistryClient): Promise<SuggestedApp | null> {
	const hit = cache.get(image);
	if (hit !== undefined) return hit;
	try {
		const { manifest } = await resolveImage(parseImageRef(image), registry);
		const app = fromManifest(manifest, image);
		cache.set(image, app);
		return app;
	} catch (error) {
		console.warn(`[apps] suggested app ${image} unavailable:`, String(error));
		cache.set(image, null);
		return null;
	}
}

/** The configured list, normalized and without entries that aren't image refs. */
function configuredImages(): string[] {
	return (PIVI_SUGGESTED_APPS ?? '').split(/[\s,]+/).flatMap((entry) => {
		try {
			return entry ? [formatImageRef(parseImageRef(entry))] : [];
		} catch {
			console.warn(`[apps] ignoring suggested app "${entry}": not an image reference`);
			return [];
		}
	});
}

/** Served by the suggestedApps GraphQL query (handlers/appManagement.ts). */
export async function suggestedApps(registry: RegistryClient): Promise<SuggestedApp[]> {
	const apps = await Promise.all(configuredImages().map((image) => describe(image, registry)));
	return apps.filter((app) => app !== null);
}
