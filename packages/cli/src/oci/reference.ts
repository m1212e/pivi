// Image references as people write them (`ghcr.io/me/app:1.0`, `oven/bun:1`,
// `localhost:5000/app@sha256:…`), resolved to the registry, repository and
// tag or digest the distribution API needs.

export type ImageRef = {
	/** The registry's host as written, `docker.io` for Docker Hub. */
	registry: string;
	repository: string;
	tag?: string;
	digest?: string;
};

const DOCKER_HUB = 'docker.io';

const looksLikeRegistry = (part: string) =>
	part.includes('.') || part.includes(':') || part === 'localhost';

export function parseReference(input: string): ImageRef {
	let rest = input.trim();
	let digest: string | undefined;
	const at = rest.indexOf('@');
	if (at !== -1) {
		digest = rest.slice(at + 1);
		rest = rest.slice(0, at);
		if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid digest in "${input}"`);
	}
	const slash = rest.lastIndexOf('/');
	const colon = rest.lastIndexOf(':');
	let tag: string | undefined;
	if (colon > slash) {
		tag = rest.slice(colon + 1);
		rest = rest.slice(0, colon);
	}
	const parts = rest.split('/');
	let registry = DOCKER_HUB;
	if (parts.length > 1 && looksLikeRegistry(parts[0]!)) registry = parts.shift()!;
	let repository = parts.join('/');
	if (registry === DOCKER_HUB && !repository.includes('/')) repository = `library/${repository}`;
	if (!/^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/.test(repository)) {
		throw new Error(
			`Invalid repository "${repository}" in "${input}": lowercase letters, digits, . _ - and /`
		);
	}
	if (!tag && !digest) tag = 'latest';
	return { registry, repository, tag, digest };
}

export function formatReference(ref: ImageRef): string {
	const name = `${ref.registry}/${ref.repository}`;
	if (ref.digest) return `${name}@${ref.digest}`;
	return `${name}:${ref.tag ?? 'latest'}`;
}

/** The host the API is served from: Docker Hub's API lives on another name than its references. */
export function apiHost(registry: string): string {
	return registry === DOCKER_HUB ? 'registry-1.docker.io' : registry;
}

/** Registries on this machine are spoken to over plain http, like docker does for localhost. */
export function isLocal(registry: string): boolean {
	const host = registry.replace(/:\d+$/, '');
	return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
