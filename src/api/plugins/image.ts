// What the host remembers about an image it has accepted: which exact build it
// is and how to run it.
export type PluginImage = {
	// The digest the plugin is pinned to (and that its signature was checked for).
	digest: string;
	// ENTRYPOINT + CMD.
	command: string[];
	workingDir?: string;
};
