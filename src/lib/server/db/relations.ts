import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

// `session` and `account` are better-auth internals (tokens, credentials) —
// they're queried directly by better-auth's own adapter, not exposed through
// rumble, so they're deliberately left out of this relation graph. There are
// no app tables yet that need a relation walked by rumble's GraphQL schema.
export const relations = defineRelations(schema, () => ({}));
