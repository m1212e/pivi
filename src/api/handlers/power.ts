// The power off in the app settings and the TV off button on the home screen.
// The work itself is in ../power.ts.
import { GraphQLError } from 'graphql';
import { schemaBuilder } from '../rumble';
import { powerOffDevice, turnOffTv } from '../power';

// The tools' own wording is what's useful when this fails.
async function attempt(work: () => Promise<void>): Promise<boolean> {
	try {
		await work();
		return true;
	} catch (error) {
		throw new GraphQLError(error instanceof Error ? error.message : String(error));
	}
}

schemaBuilder.mutationFields((t) => ({
	powerOffDevice: t.field({ type: 'Boolean', resolve: () => attempt(powerOffDevice) }),
	turnOffTv: t.field({ type: 'Boolean', resolve: () => attempt(turnOffTv) })
}));
