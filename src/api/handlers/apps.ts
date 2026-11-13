// Bridges running apps (apps/manager.ts) to the home screen and app pages.
// Kept generic, it forwards whatever an app last published and sends UI events
// back, so no app needs schema changes. Anything not yet published resolves to
// null, never an error. Subscriptions re-run the query resolver on every
// apps/pubsub.ts event so the frontend never has to poll.
import { schemaBuilder } from '../rumble';
import { defaultAppDeps } from '../apps/deps';
import {
	ANY_DASHBOARD_EVENT,
	APP_LIST_EVENT,
	forcedStopPubSub,
	type AppForcedStop
} from '../apps/events';
import { getApp, getStartedApps, holdApp, refreshDashboards } from '../apps/manager';
import { dbAppStore } from '../apps/store';
import { appPubSub } from '../apps/pubsub';
import { hasAvailableUpdate } from '../apps/updateAvailability';
import { releaseWhenDone } from '../apps/usage';

type AppInfo = {
	id: string;
	name: string;
	features: string[];
	entryScreenId: string;
	icon: string | null;
	primaryColor: string | null;
	secondaryColor: string | null;
	// Only a flag since a home screen tile just says an update is waiting,
	// the details live on the /apps screen.
	hasUpdate: boolean;
};

type AppCard = {
	id: string;
	title: string;
	subtitle: string;
	image: string;
	fallbackImage: string | null;
	// JSON encoded AppAction (#lib/apps/dashboard) so the schema doesn't
	// have to mirror the union, the frontend interprets it generically.
	actionJson: string;
};

// `cards` is null while the app hasn't published a dashboard yet, unlike `[]`
// which means it has nothing to show. The home screen needs the difference to
// show a loading skeleton instead of the empty state.
type AppDashboard = {
	appId: string;
	appName: string;
	cards: AppCard[] | null;
};

// An object rather than a scalar field so the generated client resolves it
// to plain data, see handlers/pairing.ts.
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
		fallbackImage: t.exposeString('fallbackImage', { nullable: true }),
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

const AppForcedStopRef = schemaBuilder.objectRef<AppForcedStop>('AppForcedStop').implement({
	fields: (t) => ({
		appId: t.exposeString('appId'),
		appName: t.exposeString('appName'),
		// `unresponsive` or `cpu`, which picks the toast's wording.
		reason: t.exposeString('reason')
	})
});

// Read from the database rather than the running apps, so listing apps
// never has to boot one.
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

// Doesn't wait for apps that are still booting: they report `cards: null`
// (the frontend's loading state) and publish their dashboard once up.
async function resolveDashboards(): Promise<AppDashboard[]> {
	const apps = await getStartedApps();
	const rows = await dbAppStore.list();
	return rows
		.filter((row) => row.enabled && row.approvedManifest.features.includes('dashboard'))
		.filter((row) => apps.some((entry) => entry.appId === row.appId))
		.map((row) => {
			const dashboard = apps.find((entry) => entry.appId === row.appId)?.dashboard;
			return {
				appId: row.approvedManifest.id,
				appName: row.approvedManifest.name,
				cards: dashboard
					? dashboard.cards.map((card) => ({
							id: card.id,
							title: card.title,
							subtitle: card.kind === 'resume' ? card.subtitle : card.meta,
							image: card.image,
							fallbackImage: card.fallbackImage ?? null,
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

	// An app page's UI tree (#lib/apps/ui), JSON encoded so the frontend can
	// render it generically without the schema knowing any app.
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
	// One event per app the watchdog killed, so the TV can say why it vanished.
	appForcedStop: t.field({
		type: AppForcedStopRef,
		subscribe: () => forcedStopPubSub.subscribe('apps:forcedStop'),
		resolve: (payload) => payload
	}),
	apps: t.field({
		type: [AppInfoRef],
		subscribe: () => appPubSub.subscribe(APP_LIST_EVENT),
		resolve: resolveApps
	}),
	appDashboards: t.field({
		type: [AppDashboardRef],
		// Subscribing is the home screen opening, the moment its cards should be fresh.
		subscribe: () => {
			void refreshDashboards();
			return appPubSub.subscribe(ANY_DASHBOARD_EVENT);
		},
		resolve: resolveDashboards
	}),
	appScreen: t.field({
		type: AppScreenDataRef,
		args: {
			appId: t.arg.string({ required: true }),
			screenId: t.arg.string({ required: true })
		},
		subscribe: (_root, args) =>
			// An open screen is the app in use, see usage.ts.
			releaseWhenDone(
				appPubSub.subscribe(`${args.appId}:screen:${args.screenId}`),
				holdApp(args.appId)
			),
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
			// A text input's text.
			value: t.arg.string({ required: false }),
			// A toggle's new state. Separate from `value` so the app gets a real
			// boolean, as #sdk/ui's UiEvent promises.
			checked: t.arg.boolean({ required: false })
		},
		resolve: async (_root, args) => {
			const app = await getApp(args.appId);
			app.sendUiEvent({
				screenId: args.screenId,
				eventId: args.eventId,
				value: args.checked ?? args.value ?? undefined
			});
			return true;
		}
	})
}));
