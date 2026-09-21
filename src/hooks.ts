import type { Reroute } from '@sveltejs/kit/hooks';
import { deLocalizeUrl } from '#lib/paraglide/runtime';

export const reroute: Reroute = ({ url }) => deLocalizeUrl(url).pathname;
