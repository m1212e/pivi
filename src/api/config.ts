// The host's configuration file, pivi.toml: what an installation chooses, as
// opposed to the environment variables, which describe where it runs (the
// database, ports, paths). Read from the file PIVI_CONFIG names, or from
// pivi.toml in the working directory (the repository's own during development).
// The NixOS module writes it from its options (nix/module.nix).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';
import { z } from 'zod';
import { PIVI_CONFIG } from '$app/env/private';

const configSchema = z
	.object({
		apps: z
			.object({
				/**
				 * Image references offered for one-tap install on the TV's apps screen. What each
				 * app is (name, icon, description) is read from its own manifest in the registry.
				 */
				suggested: z.array(z.string()).default([])
			})
			.strict()
			.prefault({})
	})
	.strict();

export type PiviConfig = z.infer<typeof configSchema>;

/** Where the configuration is read from. */
const configPath = () => resolve(PIVI_CONFIG ?? 'pivi.toml');

/** Parses pivi.toml's text. Throws on invalid TOML or a key the schema doesn't know. */
export function parseConfig(text: string): PiviConfig {
	return configSchema.parse(parse(text));
}

let loaded: PiviConfig | undefined;

/**
 * The configuration, read once. A missing file is the empty configuration; an
 * invalid one is logged and treated as empty too, since nothing in it is worth
 * keeping the TV from starting.
 */
export function config(): PiviConfig {
	if (loaded) return loaded;
	const path = configPath();
	let text: string | undefined;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			console.warn(`[config] cannot read ${path}:`, String(error));
		}
	}
	try {
		loaded = parseConfig(text ?? '');
	} catch (error) {
		console.warn(`[config] ignoring ${path}, it is invalid:`, String(error));
		loaded = parseConfig('');
	}
	return loaded;
}
