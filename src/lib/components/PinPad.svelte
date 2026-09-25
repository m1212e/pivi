<script lang="ts">
	import { Smartphone } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
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

	let root: HTMLDivElement | undefined = $state();
	let pressedKey = $state<string | null>(null);
	let pressedTimeout: ReturnType<typeof setTimeout> | undefined;

	// Briefly highlights the key that was just pressed, for feedback when
	// someone enters a PIN directly on the TV. Never called for a remote
	// (phone) press -- see the `pivi-remote-press` listener below -- so
	// entering a PIN from a paired phone doesn't flash which key it was on
	// the TV screen for anyone else in the room to read off.
	function flash(key: string) {
		pressedKey = key;
		clearTimeout(pressedTimeout);
		pressedTimeout = setTimeout(() => {
			pressedKey = null;
		}, 150);
	}

	function notifyIfComplete() {
		if (value.length === length) oncomplete?.(value);
	}

	function press(digit: string, { silent = false }: { silent?: boolean } = {}) {
		onkey?.(digit);
		if (value.length >= length) return;
		value += digit;
		if (!silent) flash(digit);
		notifyIfComplete();
	}

	function backspace({ silent = false }: { silent?: boolean } = {}) {
		onkey?.('backspace');
		value = value.slice(0, -1);
		if (!silent) flash('⌫');
	}

	// RemoteBridge dispatches this on the pad instead of calling .click() so
	// a phone-driven press can skip the flash above.
	$effect(() => {
		const node = root;
		if (!node) return;
		function onRemotePress(event: Event) {
			const { key } = (event as CustomEvent<{ key: string }>).detail;
			if (key === 'backspace') backspace({ silent: true });
			else press(key, { silent: true });
		}
		node.addEventListener('pivi-remote-press', onRemotePress);
		return () => node.removeEventListener('pivi-remote-press', onRemotePress);
	});

	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
</script>

<!-- A genuine top-level snippet, not one nested in the div below, so the
     key-grid's own branching is scored as its own unit instead of piling
     onto the rest of this template's complexity. -->
{#snippet keypadGrid()}
	<div class="grid grid-cols-3 gap-3" class:hidden={!showKeypad}>
		{#each keys as key, i (i)}
			{#if key === ''}
				<div></div>
			{:else if key === '⌫'}
				<button
					type="button"
					data-key="backspace"
					onclick={() => backspace()}
					aria-label={m.backspace()}
					in:fly|global={{ y: 24, duration: 400, delay: i * 40 }}
					class="flex size-16 items-center justify-center rounded-full text-xl font-medium text-white/70 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white {pressedKey ===
					'⌫'
						? 'bg-white/20'
						: ''}"
				>
					⌫
				</button>
			{:else}
				<button
					type="button"
					data-key={key}
					onclick={() => press(key)}
					in:fly|global={{ y: 24, duration: 400, delay: i * 40 }}
					class="flex size-16 items-center justify-center rounded-full bg-white/12 text-2xl font-semibold text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white {pressedKey ===
					key
						? 'scale-95 bg-white/30'
						: ''}"
				>
					{key}
				</button>
			{/if}
		{/each}
	</div>
{/snippet}

<div bind:this={root} data-pivi-pinpad class="flex flex-col items-center gap-6">
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

	{@render keypadGrid()}
</div>
