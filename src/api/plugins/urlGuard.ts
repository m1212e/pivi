// A plugin's declared domains say *where* it may send the host, but a name can
// still point somewhere it shouldn't: a public-looking hostname whose DNS answer
// is 127.0.0.1, 192.168.x.x or a cloud metadata address would turn "fetch this
// stream for me" into a request to the LAN or the host's own services. Before
// the host (ffmpeg, the stream proxy) fetches a plugin-supplied URL, its host
// has to resolve to public addresses only.
//
// This is a check at one moment, and the fetch that follows resolves the name
// again, so a name that changes its answer in between could still slip through
// (DNS rebinding). Closing that completely would mean connecting to the address
// that was checked, which the tools doing the fetching don't offer.
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const nonPublic = new BlockList();
for (const [network, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const) {
	nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
	['2001:db8::', 32]
] as const) {
	nonPublic.addSubnet(network, prefix, 'ipv6');
}

// An IPv4 address written into an IPv6 one (::ffff:10.0.0.1, or the NAT64 form)
// is judged as the IPv4 address it carries.
function embeddedIpv4(address: string): string | undefined {
	const match = address.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
	return match?.[1];
}

export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return false;
	const embedded = family === 6 ? embeddedIpv4(address) : undefined;
	if (embedded) return isPublicAddress(embedded);
	return !nonPublic.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class UnsafeUrlError extends Error {}

export async function assertPublicHost(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
		throw new UnsafeUrlError(`${hostname} does not resolve to a public address`);
	}
}
