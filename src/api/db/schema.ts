import { boolean, jsonb, snakeCase, text, timestamp } from 'drizzle-orm/pg-core';
import type { PermissionKey, AppManifest } from '#lib/apps/manifest';
import type { AppImage } from '../apps/image';
import type { AppSigner } from '../apps/signature';
import { nanoid } from '../nanoid';

const defaultTimestamps = {
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'date' })
		.defaultNow()
		.$onUpdate(() => new Date())
};

const defaultIdAndTimestamps = {
	id: text()
		.$defaultFn(() => nanoid())
		.primaryKey()
		.notNull(),
	...defaultTimestamps
};

export const user = snakeCase.table('user', {
	...defaultIdAndTimestamps,
	username: text().notNull().unique(),
	pinHash: text().notNull(),
	image: text()
});

export const pairedDevice = snakeCase.table('paired_device', {
	...defaultIdAndTimestamps,
	publicKey: text().notNull(),
	name: text(),
	lastSeenAt: timestamp({ mode: 'date' })
});

export const tvIdentity = snakeCase.table('tv_identity', {
	id: text().primaryKey().notNull().default('singleton'),
	publicKey: text().notNull(),
	secretKey: text().notNull(),
	...defaultTimestamps
});

// One row per app installed on this device (not per user: there's a single
// TV, and what an app is allowed to do is a device-level decision, unlike
// the per-profile state an app keeps in its own /storage volume). An app
// is an OCI image; this row is the host's record of *which one*, *who signed
// it* and *what the user approved* — the manifest the image ships is only ever
// a request until it's been accepted here.
// A newer version of an app that's waiting for the user to approve what it
// asks for — pulled and verified already, but not running.
export type PendingAppUpdate = { manifest: AppManifest; image: AppImage };

export const installedApp = snakeCase.table('installed_app', {
	...defaultIdAndTimestamps,
	// The manifest's own id; also what every other app-keyed table uses.
	appId: text().notNull().unique(),
	name: text().notNull(),
	version: text().notNull(),

	// What the app was installed from, written like a compose `image:`
	// (normalized, see #lib/apps/imageRef) and followed for updates — the
	// repository and tag. `imageDigest` is the exact image that's pinned and
	// runs; an update is "resolve the tag again, compare digests".
	imageRef: text().notNull(),
	imageDigest: text().notNull(),
	// How to run it, read from the image at install/update time so starting a
	// app never needs the registry (the device may be offline by then).
	imageCommand: jsonb().$type<string[]>().notNull(),
	imageWorkingDir: text(),

	// The public key the pinned image's cosign signature was verified against
	// when it was installed, supplied by the user from the publisher. An update
	// is only applied if it verifies against this same key, so a compromised
	// tag can't swap in code the key holder didn't sign. Null when the user
	// chose to install without signature verification.
	signer: jsonb().$type<AppSigner>(),

	enabled: boolean().notNull().default(true),
	autoUpdate: boolean().notNull().default(true),

	// The manifest as the user last approved it, and the permissions they
	// currently have switched on (always a subset of what that manifest asks
	// for; the network permission covers all of its domains at once). Spawning
	// an app reads these two, never anything the image says about itself.
	approvedManifest: jsonb().$type<AppManifest>().notNull(),
	grantedPermissions: jsonb().$type<PermissionKey[]>().notNull().default([]),
	// An update whose manifest asks for something new (a permission or a
	// domain) is pulled and parked here instead of replacing the running
	// version, until the user approves it.
	pendingUpdate: jsonb().$type<PendingAppUpdate>(),
	// A version the user turned down, so the next check doesn't ask again about
	// the same build.
	ignoredDigest: text(),

	lastCheckedAt: timestamp(),
	lastError: text()
});
