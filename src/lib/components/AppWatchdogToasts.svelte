<script lang="ts">
	// Tells the user when the host killed an app for hanging or burning CPU, so
	// it doesn't just silently vanish from the screen it was on.
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import * as m from '#lib/paraglide/messages';

	onMount(() => {
		const subscription = client.subscribe
			.appForcedStop({ appName: true, reason: true })
			.subscribe((event) => {
				// The store hands over its empty initial value first.
				if (!event) return;
				const name = event.appName;
				toast.error(
					event.reason === 'cpu'
						? m.apps_forced_stop_cpu({ name })
						: m.apps_forced_stop_unresponsive({ name })
				);
			});
		return () => stopSubscription(subscription);
	});
</script>
