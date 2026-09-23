// Generic playback metadata for the shared player page (src/routes/play) --
// title, duration, codecs, and whether this session goes direct or proxied,
// never the raw stream URLs (those stay server-side, consumed directly by
// src/routes/api/stream and src/routes/api/stream-track). `duration` in
// particular has to come from here rather than the eventual <video> element,
// since a live-remuxed (or MSE-fed) stream can't report its own duration
// reliably. `vcodec`/`acodec` let the player pick the right MediaSource
// mimeType/codec string for the dual-track (proxied) path without needing
// to know anything plugin-specific -- see #lib/mse's dualTrackPlayer.
import { schemaBuilder } from '../rumble';
import { getPlugin } from '../plugins/manager';
import { resolveStreamCached } from '../plugins/streamCache';
import { resolveSkipSegmentsCached } from '../plugins/skipSegmentsCache';

type PluginPlaybackInfo = {
	title: string;
	duration: number;
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: string;
	audioContainer: string | null;
};

const PluginPlaybackInfoRef = schemaBuilder
	.objectRef<PluginPlaybackInfo>('PluginPlaybackInfo')
	.implement({
		fields: (t) => ({
			title: t.exposeString('title'),
			duration: t.exposeFloat('duration'),
			// Mirrors the streaming proxy's own fast-path check (no audioUrl ==
			// one self-contained URL, handed to the browser directly) so the
			// player can show whether this session is actually going straight
			// to the source or being relayed/remuxed through this server.
			direct: t.exposeBoolean('direct'),
			vcodec: t.exposeString('vcodec'),
			acodec: t.exposeString('acodec', { nullable: true }),
			// Which container each track is actually packaged in -- not
			// reliably guessable from vcodec/acodec alone (see host.ts's
			// Container type comment), so the player needs this from here
			// rather than re-deriving it from the codec strings above.
			videoContainer: t.exposeString('videoContainer'),
			audioContainer: t.exposeString('audioContainer', { nullable: true })
		})
	});

// A skippable stretch of the video (a SponsorBlock segment, for the YouTube
// plugin) -- see #lib/plugins/host's SkipSegment for the plugin-facing side
// of this same shape.
type PluginSkipSegment = {
	startSeconds: number;
	endSeconds: number;
	label: string;
};

const PluginSkipSegmentRef = schemaBuilder
	.objectRef<PluginSkipSegment>('PluginSkipSegment')
	.implement({
		fields: (t) => ({
			startSeconds: t.exposeFloat('startSeconds'),
			endSeconds: t.exposeFloat('endSeconds'),
			label: t.exposeString('label')
		})
	});

schemaBuilder.queryFields((t) => ({
	pluginPlaybackInfo: t.field({
		type: PluginPlaybackInfoRef,
		args: {
			pluginId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true }),
			// Kept in step with the streaming proxy's own `?quality=` so this
			// hits the same cache entry instead of resolving the stream twice.
			maxHeight: t.arg.int({ required: false })
		},
		resolve: async (_root, args) => {
			const plugin = await getPlugin(args.pluginId);
			const { title, duration, audioUrl, vcodec, acodec, videoContainer, audioContainer } =
				await resolveStreamCached(
					args.pluginId,
					args.sessionId,
					plugin,
					args.maxHeight ?? undefined
				);
			return {
				title,
				duration,
				direct: !audioUrl,
				vcodec,
				acodec: acodec ?? null,
				videoContainer,
				audioContainer: audioContainer ?? null
			};
		}
	}),
	pluginSkipSegments: t.field({
		type: [PluginSkipSegmentRef],
		args: {
			pluginId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true })
		},
		resolve: async (_root, args) => {
			const plugin = await getPlugin(args.pluginId);
			return resolveSkipSegmentsCached(args.pluginId, args.sessionId, plugin);
		}
	})
}));
