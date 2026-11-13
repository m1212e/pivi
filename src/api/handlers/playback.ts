// Metadata the shared player page (routes/play) needs that the <video>
// element can't give it, like the duration of a remuxed stream or the codecs
// for MSE (#lib/mse). Raw stream and subtitle URLs never leave the server,
// the routes under routes/api/stream* proxy them.
import { schemaBuilder } from '../rumble';
import { getApp } from '../apps/manager';
import { resolveStreamCached } from '../apps/streamCache';
import { resolveSkipSegmentsCached } from '../apps/skipSegmentsCache';

// Lets the player offer a subtitle menu. Without `url`, the player fetches a
// track through routes/api/stream-subtitle by its language.
type AppSubtitleTrack = {
	language: string;
	label: string | null;
	kind: 'caption' | 'transcription';
};

function toGraphqlSubtitleTracks(
	tracks: { language: string; label?: string; kind: 'caption' | 'transcription' }[] | undefined
): AppSubtitleTrack[] {
	return (tracks ?? []).map(({ language, label, kind }) => ({
		language,
		label: label ?? null,
		kind
	}));
}

type ResolvedStream = Awaited<ReturnType<typeof resolveStreamCached>>;

function toGraphqlPlaybackInfo(stream: ResolvedStream) {
	const { title, duration, audioUrl, vcodec, acodec, videoContainer, audioContainer } = stream;
	return {
		title,
		duration,
		direct: !audioUrl,
		vcodec,
		acodec: acodec ?? null,
		videoContainer,
		audioContainer: audioContainer ?? null,
		qualities: stream.qualities ?? [],
		subtitleTracks: toGraphqlSubtitleTracks(stream.subtitleTracks)
	};
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

// Lets the player autoplay the next entry when a video ends. An object so the
// generated client resolves it to plain data, see handlers/pairing.ts.
const AppNextSessionRef = schemaBuilder
	.objectRef<{ sessionId: string | null }>('AppNextSession')
	.implement({
		fields: (t) => ({ sessionId: t.exposeString('sessionId', { nullable: true }) })
	});

type AppPlaybackInfo = {
	title: string;
	duration: number;
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: string;
	audioContainer: string | null;
	qualities: number[];
	subtitleTracks: AppSubtitleTrack[];
};

const AppPlaybackInfoRef = schemaBuilder.objectRef<AppPlaybackInfo>('AppPlaybackInfo').implement({
	fields: (t) => ({
		title: t.exposeString('title'),
		duration: t.exposeFloat('duration'),
		// Mirrors the streaming proxy's fast path check (no separate audio
		// URL) so the player can show whether it plays from the source directly.
		direct: t.exposeBoolean('direct'),
		vcodec: t.exposeString('vcodec'),
		acodec: t.exposeString('acodec', { nullable: true }),
		// Not reliably guessable from the codecs (see #sdk/protocol's containerSchema),
		// so the player gets it from here.
		videoContainer: t.exposeString('videoContainer'),
		audioContainer: t.exposeString('audioContainer', { nullable: true }),
		qualities: t.exposeIntList('qualities'),
		subtitleTracks: t.field({
			type: [AppSubtitleTrackRef],
			resolve: (parent) => parent.subtitleTracks
		})
	})
});

// A stretch the player offers to skip, like a sponsor segment. Mirrors
// #sdk/protocol's SkipSegment.
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
			const stream = await resolveStreamCached(
				args.appId,
				args.sessionId,
				app,
				args.maxHeight ?? undefined
			);
			return toGraphqlPlaybackInfo(stream);
		}
	}),
	appNextSession: t.field({
		type: AppNextSessionRef,
		args: {
			appId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true }),
			context: t.arg.string({ required: true })
		},
		resolve: async (_root, args) => {
			const app = await getApp(args.appId);
			return { sessionId: (await app.resolveNext(args.sessionId, args.context)) ?? null };
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
