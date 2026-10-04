// GraphQL surface for managing plugins from the TV's own screen, so apps can be
// installed and configured with nothing but the remote's gestures (a trackpad
// and the phone's keyboard feeding the focused field). It's the same service the
// phone's own sheet uses (pluginManagement.ts), so both always show the same
// state.
//
// Unlike everything else the TV page can call, this changes what code runs on
// the device, so every mutation requires a paired phone to be connected: the
// remote is the TV's only input device, and with none connected nobody is
// steering it. Mutations return as soon as the work is started — an install can
// take minutes — and the outcome arrives through the subscription.
import { GraphQLError } from 'graphql';
import { permissionKeySchema } from '#lib/plugins/manifest';
import { schemaBuilder } from '../rumble';
import { pluginManagement } from '../pluginManagement';
import type { PluginsState } from '../pluginManagementService';
import { PLUGIN_MANAGEMENT_EVENT } from '../plugins/events';
import { pluginPubSub } from '../plugins/pubsub';
import { hasConnectedPhone } from '../ws/relay';

type Entry = PluginsState['plugins'][number];
type Preview = NonNullable<PluginsState['preview']>;
type Update = NonNullable<Entry['update']>;

const PermissionRef = schemaBuilder
	.objectRef<Entry['permissions'][number]>('ManagedPluginPermission')
	.implement({
		fields: (t) => ({
			key: t.exposeString('key'),
			granted: t.exposeBoolean('granted')
		})
	});

const UpdateRef = schemaBuilder.objectRef<Update>('ManagedPluginUpdate').implement({
	fields: (t) => ({
		version: t.exposeString('version'),
		addedPermissions: t.exposeStringList('addedPermissions'),
		addedDomains: t.exposeStringList('addedDomains')
	})
});

const EntryRef = schemaBuilder.objectRef<Entry>('ManagedPlugin').implement({
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
		signerFingerprint: t.exposeString('signerFingerprint'),
		update: t.field({ type: UpdateRef, nullable: true, resolve: (p) => p.update }),
		// Not called `error`: the generated client throws any result object that has a
		// truthy `error` property (it checks for a failed request that way).
		errorMessage: t.string({ nullable: true, resolve: (p) => p.error })
	})
});

const PreviewRef = schemaBuilder.objectRef<Preview>('PluginInstallPreview').implement({
	fields: (t) => ({
		image: t.exposeString('image'),
		name: t.exposeString('name'),
		version: t.exposeString('version'),
		features: t.exposeStringList('features'),
		permissions: t.exposeStringList('permissions'),
		domains: t.exposeStringList('domains'),
		signerFingerprint: t.exposeString('signerFingerprint'),
		conflict: t.exposeBoolean('conflict')
	})
});

const StateRef = schemaBuilder.objectRef<PluginsState>('PluginManagement').implement({
	fields: (t) => ({
		plugins: t.field({ type: [EntryRef], resolve: (s) => s.plugins }),
		preview: t.field({ type: PreviewRef, nullable: true, resolve: (s) => s.preview }),
		busy: t.exposeString('busy', { nullable: true }),
		errorMessage: t.string({ nullable: true, resolve: (s) => s.error })
	})
});

function requireRemote(): void {
	if (!hasConnectedPhone()) {
		throw new GraphQLError('Connect your phone remote to manage apps');
	}
}

// Starts the work and returns; failures are recorded in the shared state, which
// is where the screen reads them.
function start(work: () => Promise<void> | void): boolean {
	requireRemote();
	void Promise.resolve(work()).catch(() => {});
	return true;
}

schemaBuilder.queryFields((t) => ({
	pluginManagement: t.field({ type: StateRef, resolve: () => pluginManagement.state() })
}));

schemaBuilder.subscriptionFields((t) => ({
	pluginManagement: t.field({
		type: StateRef,
		subscribe: () => pluginPubSub.subscribe(PLUGIN_MANAGEMENT_EVENT),
		resolve: () => pluginManagement.state()
	})
}));

schemaBuilder.mutationFields((t) => ({
	previewPluginInstall: t.field({
		type: 'Boolean',
		args: {
			image: t.arg.string({ required: true }),
			publicKey: t.arg.string({ required: true })
		},
		resolve: (_root, args) => start(() => pluginManagement.preview(args))
	}),
	installPlugin: t.field({
		type: 'Boolean',
		args: { granted: t.arg.stringList({ required: true }) },
		resolve: (_root, args) =>
			start(() =>
				pluginManagement.install(args.granted.map((key) => permissionKeySchema.parse(key)))
			)
	}),
	dismissPluginPreview: t.field({
		type: 'Boolean',
		resolve: () => start(() => pluginManagement.dismissPreview())
	}),
	uninstallPlugin: t.field({
		type: 'Boolean',
		args: { pluginId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => pluginManagement.uninstall(args.pluginId))
	}),
	setPluginEnabled: t.field({
		type: 'Boolean',
		args: {
			pluginId: t.arg.string({ required: true }),
			enabled: t.arg.boolean({ required: true })
		},
		resolve: (_root, args) => start(() => pluginManagement.setEnabled(args.pluginId, args.enabled))
	}),
	setPluginAutoUpdate: t.field({
		type: 'Boolean',
		args: {
			pluginId: t.arg.string({ required: true }),
			autoUpdate: t.arg.boolean({ required: true })
		},
		resolve: (_root, args) =>
			start(() => pluginManagement.setAutoUpdate(args.pluginId, args.autoUpdate))
	}),
	setPluginPermission: t.field({
		type: 'Boolean',
		args: {
			pluginId: t.arg.string({ required: true }),
			permission: t.arg.string({ required: true }),
			granted: t.arg.boolean({ required: true })
		},
		resolve: (_root, args) =>
			start(() =>
				pluginManagement.setPermission(
					args.pluginId,
					permissionKeySchema.parse(args.permission),
					args.granted
				)
			)
	}),
	approvePluginUpdate: t.field({
		type: 'Boolean',
		args: { pluginId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => pluginManagement.approveUpdate(args.pluginId))
	}),
	rejectPluginUpdate: t.field({
		type: 'Boolean',
		args: { pluginId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => pluginManagement.rejectUpdate(args.pluginId))
	}),
	clearPluginCache: t.field({
		type: 'Boolean',
		args: { pluginId: t.arg.string({ required: true }) },
		resolve: (_root, args) => start(() => pluginManagement.clearCache(args.pluginId))
	}),
	checkPluginUpdates: t.field({
		type: 'Boolean',
		resolve: () => start(() => pluginManagement.checkUpdates())
	})
}));
