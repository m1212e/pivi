import { createPubSub } from 'graphql-yoga';

/**
 * Lets the GraphQL subscriptions for app dashboards, screens and the app
 * management views (handlers/apps.ts, handlers/appManagement.ts) push changes
 * instead of the TV polling. Rumble's table-bound pubsub can't be used since
 * this state lives in running apps, not the database. Keys are built at
 * runtime (`${appId}:dashboard`, `${appId}:screen:${screenId}`, events.ts).
 */
export const appPubSub = createPubSub<Record<string, []>>();
