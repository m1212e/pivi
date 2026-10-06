/**
 * Port of the phone to TV relay (api/ws/relay.ts), shared so the server, the TV
 * bridge and the pairing session agree on it. It sits outside SvelteKit's HTTP
 * server so dev and the adapter-node build behave the same.
 * `VITE_PIVI_WS_PORT` lets a second instance (like a test run) avoid collisions.
 * nix/module.nix mirrors the default.
 */
export const PAIRING_WS_PORT = Number(import.meta.env?.VITE_PIVI_WS_PORT) || 5175;
