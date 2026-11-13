/**
 * The exact build an app runs, kept so a sandbox can boot it later without
 * asking the registry again. Stored on the row and in a parked pendingUpdate
 * (db/schema.ts), and turned into a sandbox by sandbox/spec.ts.
 */
export type AppImage = {
	// The digest the app is pinned to (and that its signature was checked for).
	digest: string;
	// ENTRYPOINT + CMD.
	command: string[];
	workingDir?: string;
};
