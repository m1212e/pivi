// The shape of wifi-management state shared between the server
// (wifiManagementService.ts) and the TV's own /wifi screen, which parses what
// it fetches over GraphQL against this same schema (see
// routes/wifi/+page.svelte's `toState`).
import { z } from 'zod';

const wifiNetworkSchema = z.object({
	ssid: z.string(),
	/** 0..100, as NetworkManager reports it. */
	signal: z.number(),
	security: z.enum(['open', 'wep', 'wpa', 'enterprise']),
	/** Whether NetworkManager already has a saved profile for this SSID. */
	saved: z.boolean()
});

export const wifiManagementSchema = z.object({
	// Whether this device can manage wifi at all (NetworkManager reachable and
	// a wireless interface present) -- a wired-only box always reports false.
	available: z.boolean(),
	mode: z.enum(['client', 'hotspot', 'disconnected']),
	ssid: z.string().nullable(),
	online: z.boolean(),
	ethernet: z.boolean(),
	// Null until a scan has completed, which is what distinguishes "no scan
	// yet" from "scanned and found nothing".
	networks: z.array(wifiNetworkSchema).nullable(),
	scanning: z.boolean(),
	// The network a join is in flight for, so a screen that reloads (or
	// re-subscribes) mid-join shows the same thing as the one that started it.
	connectingSsid: z.string().nullable(),
	error: z.string().nullable()
});
export type WifiManagementState = z.infer<typeof wifiManagementSchema>;
