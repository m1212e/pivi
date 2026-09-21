import { schemaBuilder } from '../rumble';

type Pairing = { pairingToken: string; remoteUrl: string | null };

// The token/URL themselves are minted once per browser session by
// handlePairing in hooks.server.ts (a GraphQL resolver can't set the cookie
// that remembers them) — this just reads that back onto the page. A nested
// object type (rather than two flat scalar fields) so the generated client
// resolves it to a plain usable value — see the `Response<Data, ...>` type
// in @m1212e/rumble/client: scalar top-level query fields only resolve to a
// `Subscribeable` wrapper, while object-shaped ones resolve to the real data.
const PairingRef = schemaBuilder.objectRef<Pairing>('Pairing').implement({
	fields: (t) => ({
		pairingToken: t.exposeString('pairingToken'),
		remoteUrl: t.exposeString('remoteUrl', { nullable: true })
	})
});

schemaBuilder.queryFields((t) => ({
	pairing: t.field({
		type: PairingRef,
		resolve: (_root, _args, ctx) => ({ pairingToken: ctx.pairingToken, remoteUrl: ctx.remoteUrl })
	})
}));
