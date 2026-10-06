// App management state shared by the server (appManagementService.ts) and the
// TV's /apps screen, which parses what it fetches against the same schema so
// the two sides can't drift apart.
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
	// The manifest's brand identity (manifest.ts), carried straight through.
	// Null when the app declared none.
	icon: z.string().nullable(),
	primaryColor: z.string().nullable(),
	secondaryColor: z.string().nullable()
});

// What the user is about to install, shown for approval before anything is installed.
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

// What the last "Check for updates" run found, by app id. Kept after the check
// finishes so a run with nothing to do still visibly reports a result.
const updateCheckSummarySchema = z.object({
	checkedAt: z.string(),
	applied: z.array(z.string()),
	pending: z.array(z.string()),
	failed: z.array(z.string())
});

/** Everything the /apps screen renders, parsed there from the GraphQL response. */
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
