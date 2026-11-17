// pivi's own updates for the TV: the prompt after a login and the section in
// the app settings. The work itself is in ../systemUpdate.ts.
import { GraphQLError } from 'graphql';
import { schemaBuilder } from '../rumble';
import {
	checkForSystemUpdate,
	installSystemUpdate,
	postponeSystemUpdate,
	systemUpdateStatus,
	type SystemUpdateStatus
} from '../systemUpdate';

const SystemUpdateRef = schemaBuilder.objectRef<SystemUpdateStatus>('SystemUpdate').implement({
	fields: (t) => ({
		supported: t.exposeBoolean('supported'),
		current: t.exposeString('current'),
		available: t.exposeString('available', { nullable: true }),
		checking: t.exposeBoolean('checking'),
		installing: t.exposeBoolean('installing'),
		postponed: t.exposeBoolean('postponed')
	})
});

// systemctl's own wording is what's useful when starting a unit fails.
async function attempt(work: () => Promise<unknown> | void): Promise<boolean> {
	try {
		await work();
		return true;
	} catch (error) {
		throw new GraphQLError(error instanceof Error ? error.message : String(error));
	}
}

schemaBuilder.queryFields((t) => ({
	systemUpdate: t.field({ type: SystemUpdateRef, resolve: () => systemUpdateStatus() })
}));

schemaBuilder.mutationFields((t) => ({
	checkSystemUpdate: t.field({
		type: 'Boolean',
		resolve: () => attempt(checkForSystemUpdate)
	}),
	installSystemUpdate: t.field({
		type: 'Boolean',
		resolve: () => attempt(installSystemUpdate)
	}),
	postponeSystemUpdate: t.field({
		type: 'Boolean',
		resolve: () => attempt(postponeSystemUpdate)
	})
}));
