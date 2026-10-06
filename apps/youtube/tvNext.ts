// What plays after a video inside a playlist or mix. The watch `next` endpoint
// answers with the playlist panel for both, with the current video marked, so
// one call covers regular playlists and generated mixes alike.
import { Innertube, UniversalCache } from 'youtubei.js';
import { walkObjects } from './tvTiles';

type Raw = { data: unknown };

type PanelEntry = { videoId: string; selected: boolean };

function panelEntryOf(value: unknown): PanelEntry | undefined {
	const { videoId, selected } = (value ?? {}) as { videoId?: unknown; selected?: unknown };
	return typeof videoId === 'string' ? { videoId, selected: selected === true } : undefined;
}

// Walks the response for panel renderers, which can sit in different places
// depending on the client.
function collectPanel(node: unknown, out: PanelEntry[]) {
	walkObjects(node, (obj) => {
		const entry = panelEntryOf(obj.playlistPanelVideoRenderer);
		if (entry) out.push(entry);
	});
}

export function nextInPanel(data: unknown, current: string): string | undefined {
	const panel: PanelEntry[] = [];
	collectPanel(data, panel);
	const index = panel.findIndex((entry) => entry.selected) ?? -1;
	const at = index >= 0 ? index : panel.findIndex((entry) => entry.videoId === current);
	const next = at >= 0 ? panel[at + 1] : undefined;
	return next && next.videoId !== current ? next.videoId : undefined;
}

let anonymous: Promise<Innertube> | undefined;

async function nextVia(yt: Innertube, videoId: string, playlistId: string) {
	const response = (await yt.actions.execute('/next', { videoId, playlistId })) as Raw;
	return nextInPanel(response.data, videoId);
}

// The signed-in session's web calls to this endpoint can answer 400, while a
// signed-out one reads public playlists and mixes fine. So it is tried second.
export async function fetchNextVideoId(
	innertube: Innertube,
	videoId: string,
	playlistId: string
): Promise<string | undefined> {
	try {
		return await nextVia(innertube, videoId, playlistId);
	} catch {
		anonymous ??= Innertube.create({
			cache: new UniversalCache(false),
			enable_session_cache: false
		});
		return nextVia(await anonymous, videoId, playlistId);
	}
}
