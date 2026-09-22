<script lang="ts">
	import { Smartphone } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';

	let {
		length = 4,
		value = $bindable(''),
		error = null,
		showKeypad = true,
		oncomplete,
		onkey
	}: {
		length?: number;
		value?: string;
		error?: string | null;
		// The TV itself shouldn't invite PIN entry by remote-control button
		// mashing — the phone remote is the intended input path. The key
		// grid still renders (hidden) when this is false, since the remote
		// bridge drives it by clicking [data-key] buttons directly (see
		// RemoteBridge.svelte's pressPinKey).
		showKeypad?: boolean;
		oncomplete?: (pin: string) => void;
		onkey?: (key: string) => void;
	} = $props();

	function press(digit: string) {
		onkey?.(digit);
		if (value.length >= length) return;
		value += digit;
		if (value.length === length) oncomplete?.(value);
	}

	function backspace() {
		onkey?.('backspace');
		value = value.slice(0, -1);
	}

	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
</script>

<div data-pivi-pinpad class="flex flex-col items-center gap-6">
	<div class="flex gap-4" aria-hidden="true">
		<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
		{#each Array(length) as _, i (i)}
			<span
				class="size-4 rounded-full transition {i < value.length
					? 'scale-110 bg-white'
					: 'bg-white/25'}"
			></span>
		{/each}
	</div>

	{#if error}
		<p class="-mt-2 text-sm font-medium text-rose-400">{error}</p>
	{/if}

	{#if !showKeypad}
		<div class="flex flex-col items-center gap-3 text-white/70">
			<Smartphone class="size-10" aria-hidden="true" />
			<p class="text-sm font-medium">{m.use_phone_to_enter_pin()}</p>
		</div>
	{/if}

	<div class="grid grid-cols-3 gap-3" class:hidden={!showKeypad}>
		{#each keys as key, i (i)}
			{#if key === ''}
				<div></div>
			{:else if key === '⌫'}
				<button
					type="button"
					data-key="backspace"
					onclick={backspace}
					aria-label={m.backspace()}
					class="flex size-16 items-center justify-center rounded-full text-xl font-medium text-white/70 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					⌫
				</button>
			{:else}
				<button
					type="button"
					data-key={key}
					onclick={() => press(key)}
					class="flex size-16 items-center justify-center rounded-full bg-white/12 text-2xl font-semibold text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					{key}
				</button>
			{/if}
		{/each}
	</div>
</div>
