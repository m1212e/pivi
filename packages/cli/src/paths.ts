// Where pivi-app keeps its files in a project. Everything it writes goes under
// DEV_DIR, which projects gitignore.
import { join } from 'node:path';

/** pivi-app's own directory in a project. */
export const DEV_DIR = '.pivi-dev';
/** The bundle tsdown writes (`main.mjs`), which the image copies to /app/main.mjs. */
export const BUNDLE_DIR = `${DEV_DIR}/bundle`;
export const BUNDLE_PATH = `${BUNDLE_DIR}/main.mjs`;

/** The local stand-ins for the sandbox's volumes during `pivi-app dev`. */
export const devVolume = (project: string, volume: 'storage' | 'cache') =>
	join(project, DEV_DIR, volume);
