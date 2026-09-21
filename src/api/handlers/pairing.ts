import { schemaBuilder } from '../rumble';

const Pairing = schemaBuilder
	.objectRef<{ pairingToken: string; remoteUrl: string | null }>('Pairing')
	.implement({
		fields: (t) => ({
			pairingToken: t.exposeString('pairingToken'),
			remoteUrl: t.exposeString('remoteUrl', { nullable: true })
		})
	});

schemaBuilder.queryFields((t) => ({
	// The token itself is minted (and its cookie set) in hooks.server.ts —
	// query resolvers aren't allowed to set cookies, see handlePairing there.
	pairing: t.field({
		type: Pairing,
		resolve: (_root, _args, ctx) => ({
			pairingToken: ctx.pairingToken,
			remoteUrl: ctx.remoteUrl
		})
	})
}));
