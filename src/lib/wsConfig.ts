// Standalone port for the phone<->TV control relay — deliberately not routed
// through SvelteKit/Vite's own HTTP server, so it works identically in dev
// and in the adapter-node production build without hooking into either.
//
// `VITE_PIVI_WS_PORT` overrides it when starting the dev server (or a build), so a
// second instance — a test run beside a development one — doesn't collide on the
// port. A packaged install uses the default; nix/module.nix mirrors it.
export const PAIRING_WS_PORT = Number(import.meta.env?.VITE_PIVI_WS_PORT) || 5175;
