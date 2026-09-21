import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

// No app tables need a relation walked here yet.
export const relations = defineRelations(schema, () => ({}));
