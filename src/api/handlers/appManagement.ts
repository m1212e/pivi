// GraphQL surface for managing apps from the TV's own screen, so apps can be
// installed and configured with nothing but the remote's gestures (a trackpad
// and the phone's keyboard feeding the focused field).
//
// Mutations return as soon as the work is started — an install can take
// minutes — and the outcome arrives through the subscription.
import { permissionKeySchema } from '#lib/apps/manifest';
import { schemaBuilder } from '../rumble';
import { appManagement } from '../appManagement';
import type { AppsState } from '../appManagementService';
import { APP_MANAGEMENT_EVENT } from '../apps/events';
import { appPubSub } from '../apps/pubsub';
import { suggestedApps, type SuggestedApp } from '../apps/suggested';

type Entry = AppsState['apps'][number];
type Preview = NonNullable<AppsState['preview']>;
type Update = NonNullable<Entry['update']>;
type CheckSummary = NonNullable<AppsState['lastCheckSummary']>;

const PermissionRef = schemaBuilder
	.objectRef<Entry['permissions'][number]>('ManagedAppPermission')
	.implement({
		fields: (t) => ({
			key: t.exposeString('key'),
			granted: t.exposeBoolean('granted')
		})
	});

const UpdateRef = schemaBuilder.objectRef<Update>('ManagedAppUpdate').implement({
	fields: (t) => ({
		version: t.exposeString('version'),
		addedPermissions: t.exposeStringList('addedPermissions'),
		addedDomains: t.exposeStringList('addedDomains')
	})
});

const EntryRef = schemaBuilder.objectRef<Entry>('ManagedApp').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		name: t.exposeString('name'),
		version: t.exposeString('version'),
		image: t.exposeString('image'),
		enabled: t.exposeBoolean('enabled'),
		autoUpdate: t.exposeBoolean('autoUpdate'),
		features: t.exposeStringList('features'),
		permissions: t.field({ type: [PermissionRef], resolve: (p) => p.permissions }),
		domains: t.exposeStringList('domains'),
		signerFingerprint: t.exposeString('signerFingerprint', { nullable: true }),
		update: t.field({ type: UpdateRef, nullable: true, resolve: (p) => p.update }),
		// Not called `error`: the generated client throws any result object that has a
		// truthy `error` property (it checks for a failed request that way).
		errorMessage: t.string({ nullable: true, resolve: (p) => p.error }),
		icon: t.exposeString('icon', { nullable: true }),
		primaryColor: t.exposeString('primaryColor', { nullable: true }),
		secondaryColor: t.exposeString('secondaryColor', { nullable: true })
	})
});

const PreviewRef = schemaBuilder.objectRef<Preview>('AppInstallPreview').implement({
	fields: (t) => ({
		image: t.exposeString('image'),
		name: t.exposeString('name'),
		version: t.exposeString('version'),
		features: t.exposeStringList('features'),
		permissions: t.exposeStringList('permissions'),
		domains: t.exposeStringList('domains'),
		signerFingerprint: t.exposeString('signerFingerprint', { nullable: true }),
		conflict: t.exposeBoolean('conflict'),
		icon: t.exposeString('icon', { nullable: true }),
		primaryColor: t.exposeString('primaryColor', { nullable: true }),
		secondaryColor: t.exposeString('secondaryColor', { nullable: true })
	})
});

const CheckSummaryRef = schemaBuilder.objectRef<CheckSummary>('AppUpdateCheckSummary').implement({
	fields: (t) => ({
		checkedAt: t.exposeString('checkedAt'),
		applied: t.exposeStringList('applied'),
		pending: t.exposeStringList('pending'),
		failed: t.exposeStringList('failed')
	})
});

const StateRef = schemaBuilder.objectRef<AppsState>('AppManagement').implement({
	fields: (t) => ({
		apps: t.field({ type: [EntryRef], resolve: (s) => s.apps }),
		preview: t.field({ type: PreviewRef, nullable: true, resolve: (s) => s.preview }),
		busy: t.exposeString('busy', { nullable: true }),
		errorMessage: t.string({ nullable: true, resolve: (s) => s.error }),
		lastCheckSummary: t.field({
			type: CheckSummaryRef,
			nullable: true,
			resolve: (s) => s.lastCheckSummary
		})
	})
});

const SuggestedAppRef = schemaBuilder.objectRef<SuggestedApp>('SuggestedApp').implement({
	fields: (t) => ({
		id: t.exposeString('id'),
		name: t.exposeString('name'),
		description: t.exposeString('description'),
		icon: t.exposeString('icon', { nullable: true }),
		image: t.exposeString('image'),
		publicKey: t.exposeString('publicKey', { nullable: true })
	})
});

// Starts the work and returns; failures are recorded in the shared state, which
// is where the screen reads them.
function start(work: () => Promise<void> | void): boolean {
	void Promise.resolve(work()).catch(() => {});
	return true;
}

schemaBuilder.queryFields((t) => ({
	appManagement: t.field({ type: StateRef, resolve: () => appManagement.state() }),
	suggestedApps: t.field({ type: [SuggestedAppRef], resolve: () => suggestedApps() })
}));

schemaBuilder.subscriptionFields((t) => ({
	appManagement: t.field({
		type: StateRef,
		subscribe: () => appPubSub.subscribe(APP_MANAGEMENT_EVENT),
		resolve: () => appManagement.state()
	})
}));

schemaBuilder.mutationFields((t) => ({
	previewAppInstall: t.field({
		type: 'Boolean',
		args: {
			image: t.arg.string({ required: true }),
			publicKey: t.arg.string()
		},
		resolve: (_root, args) =>
			start(() =>
				appManagement.preview({ image: args.image, publicKey: args.publicKey ?? undefined })
			)
	}),
	installApp: t.field({
		type: 'Boolean',
		args: { granted: t.arg.stringList({ required: true }) },
		resolve: (_root, args) =>
			start(() => appManagement.install(args.granted.map((key) => permissionKeySchema.parse(key))))
	}),
	dismissAppPreview: t.field({
		type: 'Boolean',
		resolve: () => start(() => appManagement.dismissPreview())
	}),
	uninstallApp: t.field({
		type: 'Boolean',
		args: { appId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => appManagement.uninstall(args.appId))
	}),
	setAppEnabled: t.field({
		type: 'Boolean',
		args: {
			appId: t.arg.string({ required: true }),
			enabled: t.arg.boolean({ required: true })
		},
		resolve: (_root, args) => start(() => appManagement.setEnabled(args.appId, args.enabled))
	}),
	setAppAutoUpdate: t.field({
		type: 'Boolean',
		args: {
			appId: t.arg.string({ required: true }),
			autoUpdate: t.arg.boolean({ required: true })
		},
		resolve: (_root, args) => start(() => appManagement.setAutoUpdate(args.appId, args.autoUpdate))
	}),
	setAppPermission: t.field({
		type: 'Boolean',
		args: {
			appId: t.arg.string({ required: true }),
			permission: t.arg.string({ required: true }),
			granted: t.arg.boolean({ required: true })
		},
		resolve: (_root, args) =>
			start(() =>
				appManagement.setPermission(
					args.appId,
					permissionKeySchema.parse(args.permission),
					args.granted
				)
			)
	}),
	approveAppUpdate: t.field({
		type: 'Boolean',
		args: { appId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => appManagement.approveUpdate(args.appId))
	}),
	rejectAppUpdate: t.field({
		type: 'Boolean',
		args: { appId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => appManagement.rejectUpdate(args.appId))
	}),
	clearAppCache: t.field({
		type: 'Boolean',
		args: { appId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => appManagement.clearCache(args.appId))
	}),
	clearAppStorage: t.field({
		type: 'Boolean',
		args: { appId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => appManagement.clearStorage(args.appId))
	}),
	checkAppUpdates: t.field({
		type: 'Boolean',
		resolve: () => start(() => appManagement.checkUpdates())
	})
}));
