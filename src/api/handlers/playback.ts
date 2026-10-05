// Generic playback metadata for the shared player page (src/routes/play) --
// title, duration, codecs, whether this session goes direct or proxied, and
// which subtitle tracks are available -- never the raw stream/subtitle URLs
// (those stay server-side, consumed directly by src/routes/api/stream,
// src/routes/api/stream-track, and src/routes/api/stream-subtitle). `duration` in
// particular has to come from here rather than the eventual <video> element,
// since a live-remuxed (or MSE-fed) stream can't report its own duration
// reliably. `vcodec`/`acodec` let the player pick the right MediaSource
// mimeType/codec string for the dual-track (proxied) path without needing
// to know anything app-specific -- see #lib/mse's dualTrackPlayer.
import { schemaBuilder } from '../rumble';
import { getApp } from '../apps/manager';
import { resolveStreamCached } from '../apps/streamCache';
import { resolveSkipSegmentsCached } from '../apps/skipSegmentsCache';

// A subtitle/caption track's own display metadata -- deliberately missing
// `url`/`format` (see host.ts's SubtitleTrack), which stay entirely
// server-side; the player fetches the actual content through
// src/routes/api/stream-subtitle, naming a track only by its language.
type AppSubtitleTrack = {
	language: string;
	label: string | null;
	kind: 'caption' | 'transcription';
};

// Drops `url`/`format` on the way out: the client never sees a track's own
// source URL (see the type comment above).
function toGraphqlSubtitleTracks(
	tracks: { language: string; label?: string; kind: 'caption' | 'transcription' }[] | undefined
): AppSubtitleTrack[] {
	return (tracks ?? []).map(({ language, label, kind }) => ({
		language,
		label: label ?? null,
		kind
	}));
}

const AppSubtitleTrackRef = schemaBuilder
	.objectRef<AppSubtitleTrack>('AppSubtitleTrack')
	.implement({
		fields: (t) => ({
			language: t.exposeString('language'),
			label: t.exposeString('label', { nullable: true }),
			kind: t.exposeString('kind')
		})
	});

type AppPlaybackInfo = {
	title: string;
	duration: number;
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: string;
	audioContainer: string | null;
	subtitleTracks: AppSubtitleTrack[];
};

const AppPlaybackInfoRef = schemaBuilder.objectRef<AppPlaybackInfo>('AppPlaybackInfo').implement({
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
		audioContainer: t.exposeString('audioContainer', { nullable: true }),
		subtitleTracks: t.field({
			type: [AppSubtitleTrackRef],
			resolve: (parent) => parent.subtitleTracks
		})
	})
});

// A skippable stretch of the video (a SponsorBlock segment, for the YouTube
// app) -- see #lib/apps/host's SkipSegment for the app-facing side
// of this same shape.
type AppSkipSegment = {
	startSeconds: number;
	endSeconds: number;
	label: string;
};

const AppSkipSegmentRef = schemaBuilder.objectRef<AppSkipSegment>('AppSkipSegment').implement({
	fields: (t) => ({
		startSeconds: t.exposeFloat('startSeconds'),
		endSeconds: t.exposeFloat('endSeconds'),
		label: t.exposeString('label')
	})
});

schemaBuilder.queryFields((t) => ({
	appPlaybackInfo: t.field({
		type: AppPlaybackInfoRef,
		args: {
			appId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true }),
			// Kept in step with the streaming proxy's own `?quality=` so this
			// hits the same cache entry instead of resolving the stream twice.
			maxHeight: t.arg.int({ required: false })
		},
		resolve: async (_root, args) => {
			const app = await getApp(args.appId);
			const {
				title,
				duration,
				audioUrl,
				vcodec,
				acodec,
				videoContainer,
				audioContainer,
				subtitleTracks
			} = await resolveStreamCached(args.appId, args.sessionId, app, args.maxHeight ?? undefined);
			return {
				title,
				duration,
				direct: !audioUrl,
				vcodec,
				acodec: acodec ?? null,
				videoContainer,
				audioContainer: audioContainer ?? null,
				subtitleTracks: toGraphqlSubtitleTracks(subtitleTracks)
			};
		}
	}),
	appSkipSegments: t.field({
		type: [AppSkipSegmentRef],
		args: {
			appId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true })
		},
		resolve: async (_root, args) => {
			const app = await getApp(args.appId);
			return resolveSkipSegmentsCached(args.appId, args.sessionId, app);
		}
	})
}));
