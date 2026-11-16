// Asked by the nightly system updater (nix/updates.nix) before it reboots the
// device. Loopback only, like everything under /api (hooks.server.ts).
import { json } from '@sveltejs/kit';
import { isDeviceBusy } from '#api/apps/manager';

// Long enough to cover pausing a video to fetch a drink.
const RECENT_USE_MS = 30 * 60_000;

export const GET = () => json({ busy: isDeviceBusy(RECENT_USE_MS) });
