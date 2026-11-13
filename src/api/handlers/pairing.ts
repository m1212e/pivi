import { GraphQLError } from 'graphql';
import { schemaBuilder } from '../rumble';

type Pairing = { pairingToken: string; remoteUrl: string | null };

// Gives the TV's pairing screen the QR code token and URL. They are minted by
// handlePairing in hooks.server.ts since a resolver can't set the cookie that
// remembers them. An object type rather than two scalars because rumble's
// generated client only resolves object shaped top level fields to plain data.
const PairingRef = schemaBuilder.objectRef<Pairing>('Pairing').implement({
	fields: (t) => ({
		pairingToken: t.exposeString('pairingToken'),
		remoteUrl: t.exposeString('remoteUrl', { nullable: true })
	})
});

schemaBuilder.queryFields((t) => ({
	pairing: t.field({
		type: PairingRef,
		resolve: (_root, _args, ctx) => {
			if (!ctx.pairingToken) throw new GraphQLError('No pairing token for this request');
			return { pairingToken: ctx.pairingToken, remoteUrl: ctx.remoteUrl ?? null };
		}
	})
}));
