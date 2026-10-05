// GraphQL surface for the app host (apps/manager.ts, apps/runtime.ts)
// — the bridge between whichever apps are installed and the frontend.
// Deliberately generic: it reads whatever an app last published and forwards
// UI events back to it, it knows nothing about any particular app.
//
// An app only has to implement the parts it actually needs. What it
// declares in its manifest's `features` decides what it's expected to
// publish: an app without the 'dashboard' feature is left out of
// `appDashboards` entirely, and one without the 'screen' feature has no app
// page content. Anything not (yet) published resolves to null, never an error.
//
// Query and Subscription fields share one resolver each — the subscription
// side just re-runs the same resolver whenever apps/manager.ts publishes an
// update (see apps/pubsub.ts), instead of the frontend polling a plain
// query on a timer and urql's cache silently hiding the fact that nothing new
// ever arrives.
import { schemaBuilder } from '../rumble';
import { defaultAppDeps } from '../apps/deps';
import { ANY_DASHBOARD_EVENT, APP_LIST_EVENT } from '../apps/events';
import { getAllApps, getApp } from '../apps/manager';
import { dbAppStore } from '../apps/store';
import { appPubSub } from '../apps/pubsub';
import { hasAvailableUpdate } from '../apps/updateAvailability';

type AppInfo = {
	id: string;
	name: string;
	features: string[];
	entryScreenId: string;
	icon: string | null;
	primaryColor: string | null;
	secondaryColor: string | null;
	// Whether a newer version is sitting in `row.pendingUpdate`, waiting for
	// the user to approve it on the /apps screen -- just a flag here (not
	// the version/added-permissions detail ManagedAppUpdate carries) since a
	// home-screen tile only ever needs to say "something's waiting," not what.
	hasUpdate: boolean;
};

type AppCard = {
	id: string;
	title: string;
	subtitle: string;
	image: string;
	// JSON-encoded AppAction (src/lib/apps/dashboard.ts) rather than
	// modeled one-to-one: the frontend only needs to interpret it generically
	// to build a link, the schema doesn't need to know the union's shape.
	actionJson: string;
};

// `cards` is null while the app hasn't published a dashboard at all yet
// (still activating/running its first refresh) -- distinct from `[]`, which
// means it finished and genuinely has nothing to show (e.g. signed out).
// Losing this distinction made the frontend unable to tell "still loading"
// from "empty," so it showed the empty-state UI on every fresh page load
// instead of a loading skeleton.
type AppDashboard = {
	appId: string;
	appName: string;
	cards: AppCard[] | null;
};

// Wrapped in an object rather than exposed as a raw top-level scalar field —
// see the comment on `Pairing` in handlers/pairing.ts: a scalar top-level
// query field resolves to a `Subscribeable` wrapper on the generated
// client, an object-shaped one resolves directly to usable data.
type AppScreenData = { json: string | null };

const AppInfoRef = schemaBuilder.objectRef<AppInfo>('AppInfo').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		name: t.exposeString('name'),
		features: t.exposeStringList('features'),
		entryScreenId: t.exposeString('entryScreenId'),
		icon: t.exposeString('icon', { nullable: true }),
		primaryColor: t.exposeString('primaryColor', { nullable: true }),
		secondaryColor: t.exposeString('secondaryColor', { nullable: true }),
		hasUpdate: t.exposeBoolean('hasUpdate')
	})
});

const AppCardRef = schemaBuilder.objectRef<AppCard>('AppCard').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		title: t.exposeString('title'),
		subtitle: t.exposeString('subtitle'),
		image: t.exposeString('image'),
		actionJson: t.exposeString('actionJson')
	})
});

const AppDashboardRef = schemaBuilder.objectRef<AppDashboard>('AppDashboard').implement({
	fields: (t) => ({
		appId: t.exposeString('appId'),
		appName: t.exposeString('appName'),
		cards: t.field({ type: [AppCardRef], nullable: true, resolve: (parent) => parent.cards })
	})
});

const AppScreenDataRef = schemaBuilder.objectRef<AppScreenData>('AppScreenData').implement({
	fields: (t) => ({
		json: t.exposeString('json', { nullable: true })
	})
});

// Straight from what's installed, without starting anything: the manifest the
// user approved is in the database.
async function resolveApps(): Promise<AppInfo[]> {
	const rows = (await dbAppStore.list()).filter((row) => row.enabled);
	return Promise.all(
		rows.map(async (row) => {
			const manifest = row.approvedManifest;
			return {
				id: manifest.id,
				name: manifest.name,
				features: manifest.features,
				entryScreenId: manifest.entryScreenId,
				icon: manifest.icon ?? null,
				primaryColor: manifest.primaryColor ?? null,
				secondaryColor: manifest.secondaryColor ?? null,
				hasUpdate: await hasAvailableUpdate(defaultAppDeps, row)
			};
		})
	);
}

async function resolveDashboards(): Promise<AppDashboard[]> {
	const apps = await getAllApps();
	return apps
		.filter((app) => app.manifest.features.includes('dashboard'))
		.map((app) => {
			const dashboard = app.getDashboard();
			return {
				appId: app.manifest.id,
				appName: app.manifest.name,
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

async function resolveScreen(appId: string, screenId: string): Promise<AppScreenData> {
	const screen = (await getApp(appId)).getScreen(screenId);
	return { json: screen ? JSON.stringify(screen.root) : null };
}

schemaBuilder.queryFields((t) => ({
	apps: t.field({ type: [AppInfoRef], resolve: resolveApps }),

	// Every dashboard-capable app's cards in one call, so the home page
	// doesn't need a query per app (which can't be a fixed set of fields).
	appDashboards: t.field({ type: [AppDashboardRef], resolve: resolveDashboards }),

	// A Tier 2 screen, JSON-encoded rather than modeled as GraphQL types
	// one-to-one — see #lib/apps/ui's UiNode; the frontend renders this
	// generically instead of the schema knowing anything app-specific.
	appScreen: t.field({
		type: AppScreenDataRef,
		args: {
			appId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true })
		},
		resolve: (_root, args) => resolveScreen(args.appId, args.screenId)
	})
}));

schemaBuilder.subscriptionFields((t) => ({
	apps: t.field({
		type: [AppInfoRef],
		subscribe: () => appPubSub.subscribe(APP_LIST_EVENT),
		resolve: resolveApps
	}),
	appDashboards: t.field({
		type: [AppDashboardRef],
		subscribe: () => appPubSub.subscribe(ANY_DASHBOARD_EVENT),
		resolve: resolveDashboards
	}),
	appScreen: t.field({
		type: AppScreenDataRef,
		args: {
			appId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true })
		},
		subscribe: (_root, args) => appPubSub.subscribe(`${args.appId}:screen:${args.screenId}`),
		resolve: (_root, args) => resolveScreen(args.appId, args.screenId)
	})
}));

schemaBuilder.mutationFields((t) => ({
	appUiEvent: t.field({
		type: 'Boolean',
		args: {
			appId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true }),
			eventId: t.arg.string({ required: true }),
			value: t.arg.string({ required: false })
		},
		resolve: async (_root, args) => {
			const app = await getApp(args.appId);
			app.sendUiEvent({
				screenId: args.screenId,
				eventId: args.eventId,
				value: args.value ?? undefined
			});
			return true;
		}
	})
}));
