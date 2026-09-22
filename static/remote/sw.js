// Minimal service worker just to satisfy install criteria for the /remote
// PWA. No precached asset manifest (the SvelteKit build's hashed filenames
// change on every deploy, so a static list would go stale) — instead,
// same-origin GET requests are cached opportunistically and served
// stale-while-revalidate, so a repeat launch is instant when online and
// still shows something while a fresh copy loads in the background.
// The remote is inherently useless without a live WebSocket to the TV, so
// there's no attempt at true offline support — the page's own "not paired" /
// disconnected UI already covers that case.
const CACHE_NAME = 'pivi-remote-v1';

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			const cached = await cache.match(request);
			const network = fetch(request)
				.then((response) => {
					if (response.ok) cache.put(request, response.clone());
					return response;
				})
				.catch(() => cached);
			return cached ?? network;
		})
	);
});
