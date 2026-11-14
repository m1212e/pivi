// Metadata the shared player page (routes/play) needs that the <video>
// element can't give it, like the duration of a remuxed stream or the codecs
// for MSE (#lib/mse). Raw stream and subtitle URLs never leave the server,
// the routes under routes/api/stream* proxy them.
import { schemaBuilder } from '../rumble';
import { getApp, holdApp } from '../apps/manager';
import { resolveStreamCached } from '../apps/streamCache';
import { resolveSkipSegmentsCached } from '../apps/skipSegmentsCache';
import { chatEventKey, chatPubSub } from '../apps/events';
import { releaseWhenDone } from '../apps/usage';
import type { ChatBatch, ChatMessage } from '@pivi/sdk/protocol';
import { markAppUsed } from '../apps/appUsage';

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

function toGraphqlPlaybackInfo(stream: ResolvedStream, chatFeature: boolean) {
	const { title, duration, audioUrl, vcodec, acodec, videoContainer, audioContainer } = stream;
	return {
		title,
		duration,
		live: stream.live ?? false,
		// Only when the app can deliver it, whatever the stream claims.
		chat: chatFeature && (stream.chat ?? false),
		direct: !audioUrl,
		vcodec,
		acodec: acodec ?? null,
		videoContainer,
		audioContainer: audioContainer ?? null,
		qualities: stream.qualities ?? [],
		subtitleTracks: toGraphqlSubtitleTracks(stream.subtitleTracks),
		// Flags the app left out are on.
		controlSeek: stream.controls?.seek ?? true,
		controlSeekButtons: stream.controls?.seekButtons ?? true,
		controlPlayPause: stream.controls?.playPause ?? true,
		controlVolume: stream.controls?.volume ?? true,
		controlSubtitles: stream.controls?.subtitles ?? true,
		controlQuality: stream.controls?.quality ?? true
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
	live: boolean;
	chat: boolean;
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: string;
	audioContainer: string | null;
	qualities: number[];
	subtitleTracks: AppSubtitleTrack[];
	controlSeek: boolean;
	controlSeekButtons: boolean;
	controlPlayPause: boolean;
	controlVolume: boolean;
	controlSubtitles: boolean;
	controlQuality: boolean;
};

const AppPlaybackInfoRef = schemaBuilder.objectRef<AppPlaybackInfo>('AppPlaybackInfo').implement({
	fields: (t) => ({
		title: t.exposeString('title'),
		duration: t.exposeFloat('duration'),
		// Still broadcasting: the player starts at the live edge and has no end to show.
		live: t.exposeBoolean('live'),
		// The player offers a chat toggle, see the appChat subscription.
		chat: t.exposeBoolean('chat'),
		// Mirrors the streaming proxy's fast path check (no separate audio
		// URL) so the player can show whether it plays from the source directly.
		direct: t.exposeBoolean('direct'),
		vcodec: t.exposeString('vcodec'),
		acodec: t.exposeString('acodec', { nullable: true }),
		// Not reliably guessable from the codecs (see @pivi/sdk/protocol's containerSchema),
		// so the player gets it from here.
		videoContainer: t.exposeString('videoContainer'),
		audioContainer: t.exposeString('audioContainer', { nullable: true }),
		qualities: t.exposeIntList('qualities'),
		// Which player controls the app allows, see @pivi/sdk/protocol's playerControlsSchema.
		controlSeek: t.exposeBoolean('controlSeek'),
		controlSeekButtons: t.exposeBoolean('controlSeekButtons'),
		controlPlayPause: t.exposeBoolean('controlPlayPause'),
		controlVolume: t.exposeBoolean('controlVolume'),
		controlSubtitles: t.exposeBoolean('controlSubtitles'),
		controlQuality: t.exposeBoolean('controlQuality'),
		subtitleTracks: t.field({
			type: [AppSubtitleTrackRef],
			resolve: (parent) => parent.subtitleTracks
		})
	})
});

// A stretch the player offers to skip, like a sponsor segment. Mirrors
// @pivi/sdk/protocol's SkipSegment.
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
		resolve: async (_root, args, ctx) => {
			// Playing something of the app counts as opening it, see appUsage.ts.
			if (ctx.user) void markAppUsed(ctx.user.id, args.appId);
			const app = await getApp(args.appId);
			const stream = await resolveStreamCached(
				args.appId,
				args.sessionId,
				app,
				args.maxHeight ?? undefined
			);
			return toGraphqlPlaybackInfo(stream, app.manifest.features.includes('chat'));
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

// The live badge's figures. An object so the generated client resolves it to
// plain data, see AppNextSessionRef.
const AppLiveStatusRef = schemaBuilder
	.objectRef<{ viewers: number | null }>('AppLiveStatus')
	.implement({
		fields: (t) => ({ viewers: t.exposeInt('viewers', { nullable: true }) })
	});

schemaBuilder.queryFields((t) => ({
	appLiveStatus: t.field({
		type: AppLiveStatusRef,
		args: {
			appId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true })
		},
		resolve: async (_root, args) => {
			const app = await getApp(args.appId);
			const status = await app.resolveLiveStatus(args.sessionId);
			return { viewers: status.viewers ?? null };
		}
	})
}));

// One chat batch as JSON, like AppScreenData: the messages are nested data
// (text runs and emotes) the player renders as is, so a GraphQL type per part
// would only repeat @pivi/sdk/protocol's ChatMessage.
const AppChatBatchRef = schemaBuilder
	.objectRef<{ json: string }>('AppChatBatch')
	.implement({ fields: (t) => ({ json: t.exposeString('json') }) });

// The backlog first, then every new batch. Wrapped so the iterator can't
// outlive the subscription: closing it (the player hiding chat or leaving)
// closes the app's chat once nobody else shows it.
function chatEvents(
	backlog: ChatMessage[],
	source: AsyncIterable<ChatBatch>
): AsyncIterable<ChatBatch> {
	const inner = source[Symbol.asyncIterator]();
	let sentBacklog = false;
	return {
		[Symbol.asyncIterator]() {
			return {
				next() {
					if (sentBacklog) return inner.next();
					sentBacklog = true;
					return Promise.resolve({ done: false, value: { messages: backlog } });
				},
				async return(value?: unknown) {
					return (await inner.return?.(value)) ?? { done: true, value: undefined };
				}
			};
		}
	};
}

schemaBuilder.subscriptionFields((t) => ({
	appChat: t.field({
		type: AppChatBatchRef,
		args: {
			appId: t.arg.string({ required: true }),
			sessionId: t.arg.string({ required: true })
		},
		subscribe: async (_root, args) => {
			const app = await getApp(args.appId);
			// Subscribed before opening, so nothing sent in between is lost.
			const source = chatPubSub.subscribe(chatEventKey(args.appId, args.sessionId));
			const close = app.openChat(args.sessionId);
			const release = holdApp(args.appId);
			return releaseWhenDone(chatEvents(app.chatBacklog(args.sessionId), source), () => {
				close();
				release();
			});
		},
		resolve: (batch: ChatBatch) => ({ json: JSON.stringify(batch) })
	})
}));
