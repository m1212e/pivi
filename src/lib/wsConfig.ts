// Standalone port for the phone<->TV control relay — deliberately not routed
// through SvelteKit/Vite's own HTTP server, so it works identically in dev
// and in the adapter-node production build without hooking into either.
export const PAIRING_WS_PORT = 5175;
