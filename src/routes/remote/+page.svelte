<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { PAIRING_WS_PORT } from '#lib/wsConfig';
	import PinPad from '#lib/components/PinPad.svelte';

	const token = page.params.token;

	let connected = $state(false);
	let socket: WebSocket | undefined;

	// What the TV is actually showing right now — reported by RemoteBridge on
	// the TV side, so the phone surfaces exactly the input method the TV
	// needs at this instant, with no manual tab-picking.
	let hasPinPad = $state(false);
	let hasTextInput = $state(false);
	let canGoBack = $state(false);

	const tab = $derived(hasPinPad ? 'pin' : hasTextInput ? 'keyboard' : 'trackpad');

	let pin = $state('');
	let text = $state('');
	let textInput: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (tab === 'keyboard') textInput?.focus();
	});

	function send(message: Record<string, unknown>) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	let touchOrigin: { x: number; y: number } | null = null;
	let touchMoved = false;
	const MOVE_THRESHOLD = 36;

	function onTouchStart(event: TouchEvent) {
		const t = event.touches[0];
		touchOrigin = { x: t.clientX, y: t.clientY };
		touchMoved = false;
	}

	function onTouchMove(event: TouchEvent) {
		if (!touchOrigin) return;
		const t = event.touches[0];
		const dx = t.clientX - touchOrigin.x;
		const dy = t.clientY - touchOrigin.y;

		if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
			send({ type: 'move', dx, dy });
			navigator.vibrate?.(3);
			touchOrigin = { x: t.clientX, y: t.clientY };
			touchMoved = true;
		}
	}

	function onTouchEnd() {
		if (!touchMoved) {
			send({ type: 'select' });
			navigator.vibrate?.(10);
		}
		touchOrigin = null;
		touchMoved = false;
	}

	function goBack() {
		send({ type: 'back' });
		navigator.vibrate?.(8);
	}

	function onPinKey(key: string) {
		send({ type: 'key', value: key });
		navigator.vibrate?.(6);
	}

	function onPinComplete() {
		pin = '';
	}

	function onTextInput() {
		send({ type: 'text', value: text });
	}

	function onTextSubmit(event: SubmitEvent) {
		event.preventDefault();
		send({ type: 'enter' });
		navigator.vibrate?.(10);
		text = '';
		onTextInput();
	}

	onMount(() => {
		socket = new WebSocket(`ws://${location.hostname}:${PAIRING_WS_PORT}/${token}`);

		socket.onopen = () => {
			connected = true;
			send({ type: 'requestState' });
		};
		socket.onclose = () => (connected = false);

		socket.onmessage = (event) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(event.data);
			} catch {
				return;
			}

			if (message.type === 'state') {
				hasPinPad = !!message.hasPinPad;
				hasTextInput = !!message.hasTextInput;
				canGoBack = !!message.canGoBack;
			}
		};

		return () => socket?.close();
	});
</script>

<svelte:head><title>Pivi Remote</title></svelte:head>

<div
	class="flex h-dvh flex-col bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 text-white"
>
	<header class="flex items-center justify-between px-4 pt-4 pb-2">
		{#if canGoBack}
			<button
				onclick={goBack}
				class="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
			>
				&larr; Back
			</button>
		{:else}
			<span></span>
		{/if}
		<span class="flex items-center gap-2 text-xs text-white/50">
			<span class="size-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-white/30'}"></span>
			{connected ? 'Connected' : 'Connecting…'}
		</span>
	</header>

	<main class="flex flex-1 flex-col items-center justify-center px-6">
		{#if tab === 'trackpad'}
			<div
				role="application"
				aria-label="Trackpad"
				ontouchstart={onTouchStart}
				ontouchmove={onTouchMove}
				ontouchend={onTouchEnd}
				class="flex size-full max-h-96 w-full max-w-sm touch-none items-center justify-center rounded-3xl bg-white/5 ring-1 ring-white/10 select-none"
			>
				<p class="px-8 text-center text-sm text-white/40">Swipe to move, tap to select</p>
			</div>
		{:else if tab === 'pin'}
			<PinPad bind:value={pin} onkey={onPinKey} oncomplete={onPinComplete} />
		{:else}
			<form onsubmit={onTextSubmit} class="flex w-full max-w-sm flex-col items-center gap-3">
				<input
					bind:this={textInput}
					bind:value={text}
					oninput={onTextInput}
					enterkeyhint="go"
					placeholder="Type here…"
					class="w-full rounded-full bg-white/10 px-6 py-4 text-center text-lg text-white placeholder-white/40 ring-1 ring-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
				/>
				<button
					type="submit"
					aria-label="Enter"
					class="w-full rounded-full bg-white px-6 py-4 text-lg font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					Enter
				</button>
			</form>
		{/if}
	</main>
</div>
