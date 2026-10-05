// The shape of app-management state shared between the server
// (appManagementService.ts) and the TV's own /apps screen, which parses
// what it fetches over GraphQL against this same schema (see
// routes/apps/+page.svelte's `toState`).
import { z } from 'zod';
import { featureSchema, permissionKeySchema } from './manifest';

const appPermissionSchema = z.object({ key: permissionKeySchema, granted: z.boolean() });

const appUpdateSchema = z.object({
	version: z.string(),
	addedPermissions: z.array(permissionKeySchema),
	addedDomains: z.array(z.string())
});

const installedAppSchema = z.object({
	id: z.string(),
	name: z.string(),
	version: z.string(),
	image: z.string(),
	enabled: z.boolean(),
	autoUpdate: z.boolean(),
	features: z.array(featureSchema),
	permissions: z.array(appPermissionSchema),
	// What the `network` permission covers, verbatim, so the user sees exactly
	// which domains a single toggle opens up.
	domains: z.array(z.string()),
	// Null for an app installed without a signature check.
	signerFingerprint: z.string().nullable(),
	// A newer version waiting for the user to approve what it asks for.
	update: appUpdateSchema.nullable(),
	error: z.string().nullable(),
	// The manifest's brand identity (manifest.ts), carried straight through —
	// null when the app declared none.
	icon: z.string().nullable(),
	primaryColor: z.string().nullable(),
	secondaryColor: z.string().nullable()
});

const appPreviewSchema = z.object({
	image: z.string(),
	name: z.string(),
	version: z.string(),
	features: z.array(featureSchema),
	permissions: z.array(permissionKeySchema),
	domains: z.array(z.string()),
	signerFingerprint: z.string().nullable(),
	conflict: z.boolean(),
	icon: z.string().nullable(),
	primaryColor: z.string().nullable(),
	secondaryColor: z.string().nullable()
});

// What the last "Check for updates" run found, by app id -- shown once busy
// goes back to null so the button's own result is visible instead of silently
// vanishing the instant the check finishes (an app whose version string
// never changes between builds, say, would otherwise look like the check
// did nothing at all, successful "nothing to do" included).
const updateCheckSummarySchema = z.object({
	checkedAt: z.string(),
	applied: z.array(z.string()),
	pending: z.array(z.string()),
	failed: z.array(z.string())
});
export type UpdateCheckSummary = z.infer<typeof updateCheckSummarySchema>;

export const appsStateSchema = z.object({
	apps: z.array(installedAppSchema),
	preview: appPreviewSchema.nullable(),
	// What the host is in the middle of, so a screen that reloads (or a second
	// one) shows the same thing as the one that asked.
	busy: z.enum(['previewing', 'installing', 'checking', 'working']).nullable(),
	error: z.string().nullable(),
	lastCheckSummary: updateCheckSummarySchema.nullable()
});
export type AppsState = z.infer<typeof appsStateSchema>;
