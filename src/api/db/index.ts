import { drizzle } from 'drizzle-orm/node-postgres';
import { building } from '$app/env';
import { DATABASE_URL } from '$app/env/private';
import { relations } from './relations';

const conf = { relations, jit: true } as const;

if (!building && !DATABASE_URL) throw new Error('DATABASE_URL is not set');

export const db = building ? drizzle.mock(conf) : drizzle(DATABASE_URL, conf);
