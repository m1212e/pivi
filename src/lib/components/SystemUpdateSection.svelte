<script lang="ts">
	// pivi's own updates in the app settings (routes/apps): the version running,
	// a manual check, and installing what the device downloaded. Polled while
	// open, since a check runs for minutes in the background on the device.
	import { CircleArrowUp, LoaderCircle } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import { client } from '#lib/api/rumbleClient/client';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import { pollEvery } from '#lib/poll';
	import { getSystemUpdate, type SystemUpdate } from '#lib/state/systemUpdate';
	import Button from './Button.svelte';

	let { initial }: { initial: SystemUpdate } = $props();

	// svelte-ignore state_referenced_locally
	let update = $state(initial);
	let error = $state<string | null>(null);
	// Set right away on a press: the device only reports the check as running
	// once systemd has started it.
	let requested = $state(false);

	$effect(() =>
		pollEvery(3_000, getSystemUpdate, (next) => {
			update = next;
			if (next.checking) requested = false;
		})
	);

	function run(request: Promise<unknown>) {
		error = null;
		request.catch((err: unknown) => {
			requested = false;
			error = graphQLErrorMessage(err, m.system_update_failed());
		});
	}

	function check() {
		requested = true;
		run(client.mutate.checkSystemUpdate());
		// The poll above only notices a check while it runs, and a quick one
		// may be over before then.
		setTimeout(() => (requested = false), 10_000);
	}

	function install() {
		run(client.mutate.installSystemUpdate().then(() => (update = { ...update, installing: true })));
	}

	const checking = $derived(update.checking || requested);
</script>

<section class="flex max-w-xl flex-col gap-4 rounded-3xl bg-white/8 p-6 ring-1 ring-white/15">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-lg font-semibold">{m.system_update_title()}</h2>
			<p class="text-sm text-white/60">{m.system_update_current({ version: update.current })}</p>
		</div>
		{#if update.available && !update.installing}
			<CircleArrowUp class="size-7 text-indigo-300" />
		{/if}
	</div>

	{#if !update.supported}
		<p class="text-sm text-white/60">{m.system_update_unsupported()}</p>
	{:else if update.installing}
		<p class="flex items-center gap-2 text-sm text-white/80">
			<LoaderCircle class="size-4 animate-spin" />
			{m.system_update_installing()}
		</p>
	{:else}
		<p class="flex items-center gap-2 text-sm text-white/80">
			{#if checking}
				<LoaderCircle class="size-4 animate-spin" />
				{m.system_update_checking()}
			{:else if update.available}
				{m.system_update_ready({ version: update.available })}
			{:else}
				{m.system_update_up_to_date()}
			{/if}
		</p>
		{#if error}
			<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
				{error}
			</p>
		{/if}
		<div class="flex gap-3">
			<Button size="md" onclick={check} disabled={checking}>{m.system_update_check()}</Button>
			{#if update.available}
				<Button variant="solid" size="md" onclick={install}>{m.system_update_install()}</Button>
			{/if}
		</div>
	{/if}
</section>
