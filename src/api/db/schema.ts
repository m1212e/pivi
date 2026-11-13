import { boolean, jsonb, snakeCase, text, timestamp } from 'drizzle-orm/pg-core';
import type { PermissionKey, AppManifest } from '#sdk/manifest';
import type { AppImage } from '../apps/image';
import type { AppSigner } from '../apps/signature';
import { nanoid } from '../nanoid';

// Tables for profiles, paired phones, the TV's identity and installed apps.
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

// Profiles on this device. Login is a 4 digit PIN, stored only as a hash.
export const user = snakeCase.table('user', {
	...defaultIdAndTimestamps,
	username: text().notNull().unique(),
	pinHash: text().notNull(),
	image: text()
});

// Phones that completed pairing. The relay checks their signatures against
// `publicKey`, and `lastSeenAt` lets deviceCleanup drop abandoned ones.
export const pairedDevice = snakeCase.table('paired_device', {
	...defaultIdAndTimestamps,
	publicKey: text().notNull(),
	name: text(),
	lastSeenAt: timestamp({ mode: 'date' })
});

// A single row holding this TV's keypair (see pairing.ts), so phones can
// recognize the relay after a restart.
export const tvIdentity = snakeCase.table('tv_identity', {
	id: text().primaryKey().notNull().default('singleton'),
	publicKey: text().notNull(),
	secretKey: text().notNull(),
	...defaultTimestamps
});

// Types `installedApp.pendingUpdate`: a newer version already pulled and
// verified, parked until the user approves what it asks for.
export type PendingAppUpdate = { manifest: AppManifest; image: AppImage };

// One row per installed app, accessed through apps/store.ts. Per device, not
// per user, since what an app may do is a device level decision. This is the
// host's record of which image, who signed it and what the user approved, the
// manifest an image ships is only a request until it's accepted here.
export const installedApp = snakeCase.table('installed_app', {
	...defaultIdAndTimestamps,
	// The manifest's own id, also what every other app keyed table uses.
	appId: text().notNull().unique(),
	name: text().notNull(),
	version: text().notNull(),

	// What the app was installed from, like a compose `image:` (normalized,
	// see #lib/apps/imageRef), followed for updates. `imageDigest` is the
	// pinned image that runs, an update resolves the tag and compares digests.
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

	// The manifest as the user last approved it and the permissions they have
	// switched on, always a subset of what it asks for. Spawning an app reads
	// these two, never anything the image says about itself.
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
