// GraphQL surface for the YouTube plugin prototype — the bridge between the
// plugin host (plugins/manager.ts, plugins/runtime.ts) and the frontend.
// Deliberately thin: it reads whatever the plugin last published and
// forwards UI events back to it, it doesn't know anything about YouTube
// itself.
//
// Query and Subscription fields share one resolver each (resolveDashboard/
// resolveAuth/resolveScreen below) — the subscription side just re-runs the
// same resolver whenever plugins/manager.ts publishes an update (see
// plugins/pubsub.ts), instead of the frontend polling a plain query on a
// timer and urql's cache silently hiding the fact that nothing new ever
// arrives.
import { schemaBuilder } from '../rumble';
import { getYoutubePlugin } from '../plugins/manager';
import { pluginPubSub } from '../plugins/pubsub';

const PLUGIN_ID = 'youtube';

type YoutubeCard = {
	id: string;
	title: string;
	subtitle: string;
	image: string;
	appName: string;
	// JSON-encoded PluginAction (src/lib/plugins/dashboard.ts) rather than
	// modeled one-to-one — same reasoning as YoutubeScreenRef's `json` field:
	// the frontend only needs to interpret it generically to build a link,
	// the schema doesn't need to know the union's shape.
	actionJson: string;
};
type YoutubeAuth = { status: string; userCode: string; verificationUrl: string };
type YoutubeScreen = { json: string | null };

const YoutubeCardRef = schemaBuilder.objectRef<YoutubeCard>('YoutubeCard').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		title: t.exposeString('title'),
		subtitle: t.exposeString('subtitle'),
		image: t.exposeString('image'),
		appName: t.exposeString('appName'),
		actionJson: t.exposeString('actionJson')
	})
});

const YoutubeAuthRef = schemaBuilder.objectRef<YoutubeAuth>('YoutubeAuth').implement({
	fields: (t) => ({
		status: t.exposeString('status'),
		userCode: t.exposeString('userCode'),
		verificationUrl: t.exposeString('verificationUrl')
	})
});

// Wrapped in an object rather than exposed as a raw top-level scalar field —
// see the comment on `Pairing` in handlers/pairing.ts: a scalar top-level
// query field resolves to a `Subscribeable` wrapper on the generated
// client, an object-shaped one resolves directly to usable data.
const YoutubeScreenRef = schemaBuilder.objectRef<YoutubeScreen>('YoutubeScreen').implement({
	fields: (t) => ({
		json: t.exposeString('json', { nullable: true })
	})
});

// `null` means the plugin hasn't published a dashboard at all yet (still
// activating/running its first refresh) -- distinct from `[]`, which means
// it finished and genuinely has nothing to show (e.g. signed out). Losing
// this distinction (as `dashboard?.cards ?? []` used to) made the frontend
// unable to tell "still loading" from "empty," so it showed the empty-state
// UI on every fresh page load instead of a loading skeleton.
async function resolveDashboard(): Promise<YoutubeCard[] | null> {
	const plugin = await getYoutubePlugin();
	const dashboard = plugin.getDashboard();
	if (!dashboard) return null;
	return dashboard.cards.map((card) => ({
		id: card.id,
		title: card.title,
		subtitle: card.kind === 'resume' ? card.subtitle : card.meta,
		image: card.image,
		appName: plugin.manifest.name,
		actionJson: JSON.stringify(card.action)
	}));
}

async function resolveAuth(): Promise<YoutubeAuth | null> {
	const plugin = await getYoutubePlugin();
	const auth = plugin.getAuth();
	if (!auth || !('userCode' in auth)) return null;
	return { status: auth.status, userCode: auth.userCode, verificationUrl: auth.verificationUrl };
}

async function resolveScreen(): Promise<YoutubeScreen> {
	const plugin = await getYoutubePlugin();
	const screen = plugin.getScreen('browse');
	return { json: screen ? JSON.stringify(screen.root) : null };
}

schemaBuilder.queryFields((t) => ({
	youtubeDashboard: t.field({ type: [YoutubeCardRef], nullable: true, resolve: resolveDashboard }),

	// Present only while a device-code sign-in is pending/just finished — a
	// code + link is enough to render this, no per-plugin login screen
	// needed (see SKETCH.md's "Login" decision). youtubei.js's own device
	// flow backs this now (plugins/youtube/auth.ts) rather than a Google
	// Cloud OAuth client we'd have to register.
	youtubeAuth: t.field({ type: YoutubeAuthRef, nullable: true, resolve: resolveAuth }),

	// The Tier 2 screen (search box + results), JSON-encoded rather than
	// modeled as GraphQL types one-to-one — see #lib/plugins/ui's UiNode; the
	// frontend renders this generically instead of the schema knowing
	// anything YouTube-specific about it.
	youtubeScreen: t.field({ type: YoutubeScreenRef, resolve: resolveScreen })
}));

schemaBuilder.subscriptionFields((t) => ({
	youtubeDashboard: t.field({
		type: [YoutubeCardRef],
		nullable: true,
		subscribe: () => pluginPubSub.subscribe(`${PLUGIN_ID}:dashboard`),
		resolve: resolveDashboard
	}),
	youtubeAuth: t.field({
		type: YoutubeAuthRef,
		nullable: true,
		subscribe: () => pluginPubSub.subscribe(`${PLUGIN_ID}:auth`),
		resolve: resolveAuth
	}),
	youtubeScreen: t.field({
		type: YoutubeScreenRef,
		subscribe: () => pluginPubSub.subscribe(`${PLUGIN_ID}:screen:browse`),
		resolve: resolveScreen
	})
}));

schemaBuilder.mutationFields((t) => ({
	youtubeUiEvent: t.field({
		type: 'Boolean',
		args: {
			eventId: t.arg.string({ required: true }),
			value: t.arg.string({ required: false })
		},
		resolve: async (_root, args) => {
			const plugin = await getYoutubePlugin();
			plugin.sendUiEvent({
				screenId: 'browse',
				eventId: args.eventId,
				value: args.value ?? undefined
			});
			return true;
		}
	})
}));
