// Retired. This used to be a stale-while-revalidate cache for the remote page,
// which can only run on a secure origin and could keep serving an outdated
// page (and so an outdated pairing handshake) to a phone. Phones that still
// have it installed pick up this version, which clears its caches and removes
// itself.
self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
			.then(() => self.registration.unregister())
	);
});
