// The Containerfile of a pivi app: its bundle (/app/main.mjs, built by tsdown) on
// Node. `pivi-app init` scaffolds it into the project, and `pivi-app build` uses an
// equivalent one for a project that has none. The manifest is not in it: it is
// added as the dev.pivi.manifest label at build time, so manifest.json stays the
// only place it is written.

import { BUNDLE_PATH } from '../paths';

/**
 * The Node major apps run on: the image's base and what tsdown compiles for. Node's
 * current LTS, pinned to its major so a rebuild never jumps to a new Node.
 */
export const NODE_MAJOR = 26;
// Fully qualified, so buildah never asks which registry a short name means.
const BASE = `docker.io/library/node:${NODE_MAJOR}-alpine`;

export function containerfile(): string {
	return `# The image pivi runs: the app's bundle (${BUNDLE_PATH}, built by
# \`pivi-app build\` with tsdown) on Node.
# Build it with \`pivi-app build\` or \`pivi-app publish\`, which bundle the app first and
# add manifest.json as the dev.pivi.manifest label. Add RUN steps for anything else the
# app needs in the image (a system package, a binary).
FROM ${BASE}
COPY ${BUNDLE_PATH} /app/main.mjs
WORKDIR /app
ENTRYPOINT ["node", "/app/main.mjs"]
`;
}

/** Only the bundle goes into the build context; node_modules and sources stay out. */
export const containerignore = `*\n!${BUNDLE_PATH}\n`;
