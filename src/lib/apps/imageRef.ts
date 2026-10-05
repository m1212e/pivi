// Where an app comes from: an OCI image reference, written the way a
// docker-compose `image:` is. A bare `name` or `owner/name` is on Docker Hub;
// anything else names its registry first (`ghcr.io/owner/name:1.2`,
// `registry.example.com:5000/name`). The same rules Docker itself uses to
// tell the two apart, so a reference copied from a compose file means what the
// person expects.
const DOCKER_HUB = 'docker.io';

export type ImageRef = {
	// Canonical registry name, e.g. `docker.io`, `ghcr.io`, `localhost:5000`.
	registry: string;
	// Always includes the namespace; Docker Hub's bare `nginx` is `library/nginx`.
	repository: string;
	// Absent only when a digest pins the image instead.
	tag?: string;
	digest?: string;
};

const COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG = /^[\w][\w.-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

// The first path component is a registry rather than a namespace when it
// looks like a host — contains a dot or a port, or is literally `localhost`.
function looksLikeRegistry(component: string): boolean {
	return component.includes('.') || component.includes(':') || component === 'localhost';
}

// Splits off a trailing `@sha256:…`.
function splitDigest(reference: string, input: string): { rest: string; digest?: string } {
	const at = reference.indexOf('@');
	if (at === -1) return { rest: reference };

	const digest = reference.slice(at + 1);
	if (!DIGEST.test(digest)) throw new Error(`Unsupported digest in "${input}"`);
	return { rest: reference.slice(0, at), digest };
}

// A ':' only starts a tag if it comes after the last '/', otherwise it's a
// registry port.
function splitTag(reference: string, input: string): { rest: string; tag?: string } {
	const colon = reference.lastIndexOf(':');
	if (colon <= reference.lastIndexOf('/')) return { rest: reference };

	const tag = reference.slice(colon + 1);
	if (!TAG.test(tag)) throw new Error(`Invalid tag in "${input}"`);
	return { rest: reference.slice(0, colon), tag };
}

function canonicalRegistry(name: string): string {
	const registry = name.toLowerCase();
	return registry === 'index.docker.io' || registry === 'registry-1.docker.io'
		? DOCKER_HUB
		: registry;
}

// Whatever is left after the registry (if the reference named one).
function splitRegistry(path: string): { registry: string; parts: string[] } {
	const parts = path.split('/');
	if (parts.length > 1 && looksLikeRegistry(parts[0])) {
		return { registry: canonicalRegistry(parts.shift()!), parts };
	}
	return { registry: DOCKER_HUB, parts };
}

export function parseImageRef(input: string): ImageRef {
	const reference = input.trim();
	if (!reference) throw new Error('Empty image reference');

	const { rest: withoutDigest, digest } = splitDigest(reference, input);
	const { rest: path, tag } = splitTag(withoutDigest, input);
	const { registry, parts } = splitRegistry(path);

	// Docker Hub's bare `nginx` is `library/nginx`.
	if (registry === DOCKER_HUB && parts.length === 1) parts.unshift('library');
	if (!parts.every((part) => COMPONENT.test(part))) {
		throw new Error(`Invalid repository in "${input}"`);
	}

	return {
		registry,
		repository: parts.join('/'),
		tag: tag ?? (digest ? undefined : 'latest'),
		digest
	};
}

export function formatImageRef({ registry, repository, tag, digest }: ImageRef): string {
	return `${registry}/${repository}${tag ? `:${tag}` : ''}${digest ? `@${digest}` : ''}`;
}

// The host to actually talk to for this registry's API — Docker Hub's lives
// somewhere other than its pull name.
export function registryApiHost(registry: string): string {
	return registry === DOCKER_HUB ? 'registry-1.docker.io' : registry;
}
