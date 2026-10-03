// GraphQL surface for the plugin host (plugins/manager.ts, plugins/runtime.ts)
// — the bridge between whichever plugins are installed and the frontend.
// Deliberately generic: it reads whatever a plugin last published and forwards
// UI events back to it, it knows nothing about any particular plugin.
//
// A plugin only has to implement the parts it actually needs. What it
// declares in its manifest's `features` decides what it's expected to
// publish: a plugin without the 'dashboard' feature is left out of
// `pluginDashboards` entirely, and one without the 'screen' feature has no app
// page content. Anything not (yet) published resolves to null, never an error.
//
// Query and Subscription fields share one resolver each — the subscription
// side just re-runs the same resolver whenever plugins/manager.ts publishes an
// update (see plugins/pubsub.ts), instead of the frontend polling a plain
// query on a timer and urql's cache silently hiding the fact that nothing new
// ever arrives.
import { schemaBuilder } from '../rumble';
import { ANY_DASHBOARD_EVENT, PLUGIN_LIST_EVENT } from '../plugins/events';
import { getAllPlugins, getPlugin } from '../plugins/manager';
import { dbPluginStore } from '../plugins/store';
import { pluginPubSub } from '../plugins/pubsub';

type PluginInfo = {
	id: string;
	name: string;
	features: string[];
	entryScreenId: string;
};

type PluginCard = {
	id: string;
	title: string;
	subtitle: string;
	image: string;
	// JSON-encoded PluginAction (src/lib/plugins/dashboard.ts) rather than
	// modeled one-to-one: the frontend only needs to interpret it generically
	// to build a link, the schema doesn't need to know the union's shape.
	actionJson: string;
};

// `cards` is null while the plugin hasn't published a dashboard at all yet
// (still activating/running its first refresh) -- distinct from `[]`, which
// means it finished and genuinely has nothing to show (e.g. signed out).
// Losing this distinction made the frontend unable to tell "still loading"
// from "empty," so it showed the empty-state UI on every fresh page load
// instead of a loading skeleton.
type PluginDashboard = {
	pluginId: string;
	pluginName: string;
	cards: PluginCard[] | null;
};

type PluginAuthState = { status: string; userCode: string; verificationUrl: string };

// Wrapped in an object rather than exposed as a raw top-level scalar field —
// see the comment on `Pairing` in handlers/pairing.ts: a scalar top-level
// query field resolves to a `Subscribeable` wrapper on the generated
// client, an object-shaped one resolves directly to usable data.
type PluginScreenData = { json: string | null };

const PluginInfoRef = schemaBuilder.objectRef<PluginInfo>('PluginInfo').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		name: t.exposeString('name'),
		features: t.exposeStringList('features'),
		entryScreenId: t.exposeString('entryScreenId')
	})
});

const PluginCardRef = schemaBuilder.objectRef<PluginCard>('PluginCard').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		title: t.exposeString('title'),
		subtitle: t.exposeString('subtitle'),
		image: t.exposeString('image'),
		actionJson: t.exposeString('actionJson')
	})
});

const PluginDashboardRef = schemaBuilder.objectRef<PluginDashboard>('PluginDashboard').implement({
	fields: (t) => ({
		pluginId: t.exposeString('pluginId'),
		pluginName: t.exposeString('pluginName'),
		cards: t.field({ type: [PluginCardRef], nullable: true, resolve: (parent) => parent.cards })
	})
});

const PluginAuthStateRef = schemaBuilder.objectRef<PluginAuthState>('PluginAuthState').implement({
	fields: (t) => ({
		status: t.exposeString('status'),
		userCode: t.exposeString('userCode'),
		verificationUrl: t.exposeString('verificationUrl')
	})
});

const PluginScreenDataRef = schemaBuilder
	.objectRef<PluginScreenData>('PluginScreenData')
	.implement({
		fields: (t) => ({
			json: t.exposeString('json', { nullable: true })
		})
	});

// Straight from what's installed, without starting anything: the manifest the
// user approved is in the database.
async function resolvePlugins(): Promise<PluginInfo[]> {
	return (await dbPluginStore.list())
		.filter((row) => row.enabled)
		.map(({ approvedManifest: manifest }) => ({
			id: manifest.id,
			name: manifest.name,
			features: manifest.features,
			entryScreenId: manifest.entryScreenId
		}));
}

async function resolveDashboards(): Promise<PluginDashboard[]> {
	const plugins = await getAllPlugins();
	return plugins
		.filter((plugin) => plugin.manifest.features.includes('dashboard'))
		.map((plugin) => {
			const dashboard = plugin.getDashboard();
			return {
				pluginId: plugin.manifest.id,
				pluginName: plugin.manifest.name,
				cards: dashboard
					? dashboard.cards.map((card) => ({
							id: card.id,
							title: card.title,
							subtitle: card.kind === 'resume' ? card.subtitle : card.meta,
							image: card.image,
							actionJson: JSON.stringify(card.action)
						}))
					: null
			};
		});
}

// Only a device-code login is surfaced here; a phone-handoff login is pushed
// straight to the paired phone by the host (see runtime.ts) and has nothing
// for the TV to render.
async function resolveAuth(pluginId: string): Promise<PluginAuthState | null> {
	const auth = (await getPlugin(pluginId)).getAuth();
	if (!auth || !('userCode' in auth)) return null;
	return { status: auth.status, userCode: auth.userCode, verificationUrl: auth.verificationUrl };
}

async function resolveScreen(pluginId: string, screenId: string): Promise<PluginScreenData> {
	const screen = (await getPlugin(pluginId)).getScreen(screenId);
	return { json: screen ? JSON.stringify(screen.root) : null };
}

schemaBuilder.queryFields((t) => ({
	plugins: t.field({ type: [PluginInfoRef], resolve: resolvePlugins }),

	// Every dashboard-capable plugin's cards in one call, so the home page
	// doesn't need a query per plugin (which can't be a fixed set of fields).
	pluginDashboards: t.field({ type: [PluginDashboardRef], resolve: resolveDashboards }),

	// Present only while a device-code sign-in is pending/just finished — a
	// code + link is enough to render this, no per-plugin login screen
	// needed (see SKETCH.md's "Login" decision).
	pluginAuth: t.field({
		type: PluginAuthStateRef,
		nullable: true,
		args: { pluginId: t.arg.string({ required: true }) },
		resolve: (_root, args) => resolveAuth(args.pluginId)
	}),

	// A Tier 2 screen, JSON-encoded rather than modeled as GraphQL types
	// one-to-one — see #lib/plugins/ui's UiNode; the frontend renders this
	// generically instead of the schema knowing anything plugin-specific.
	pluginScreen: t.field({
		type: PluginScreenDataRef,
		args: {
			pluginId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true })
		},
		resolve: (_root, args) => resolveScreen(args.pluginId, args.screenId)
	})
}));

schemaBuilder.subscriptionFields((t) => ({
	plugins: t.field({
		type: [PluginInfoRef],
		subscribe: () => pluginPubSub.subscribe(PLUGIN_LIST_EVENT),
		resolve: resolvePlugins
	}),
	pluginDashboards: t.field({
		type: [PluginDashboardRef],
		subscribe: () => pluginPubSub.subscribe(ANY_DASHBOARD_EVENT),
		resolve: resolveDashboards
	}),
	pluginAuth: t.field({
		type: PluginAuthStateRef,
		nullable: true,
		args: { pluginId: t.arg.string({ required: true }) },
		subscribe: (_root, args) => pluginPubSub.subscribe(`${args.pluginId}:auth`),
		resolve: (_root, args) => resolveAuth(args.pluginId)
	}),
	pluginScreen: t.field({
		type: PluginScreenDataRef,
		args: {
			pluginId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true })
		},
		subscribe: (_root, args) => pluginPubSub.subscribe(`${args.pluginId}:screen:${args.screenId}`),
		resolve: (_root, args) => resolveScreen(args.pluginId, args.screenId)
	})
}));

schemaBuilder.mutationFields((t) => ({
	pluginUiEvent: t.field({
		type: 'Boolean',
		args: {
			pluginId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true }),
			eventId: t.arg.string({ required: true }),
			value: t.arg.string({ required: false })
		},
		resolve: async (_root, args) => {
			const plugin = await getPlugin(args.pluginId);
			plugin.sendUiEvent({
				screenId: args.screenId,
				eventId: args.eventId,
				value: args.value ?? undefined
			});
			return true;
		}
	})
}));
