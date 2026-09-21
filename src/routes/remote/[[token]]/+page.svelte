<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { connectRemoteSession, type RemoteSession } from '#lib/pairing/session';
	import PinPad from '#lib/components/PinPad.svelte';
	import * as m from '#lib/paraglide/messages';

	let phase = $state<'connecting' | 'not-paired' | 'error' | 'ready'>('connecting');
	let errorMessage = $state('');
	let connected = $state(false);
	let session: RemoteSession | undefined;

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
		session?.send(message);
	}

	let touchOrigin: { x: number; y: number } | null = null;
	let touchMoved = false;
	const MOVE_THRESHOLD = 48;

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
		let cancelled = false;

		connectRemoteSession(page.params.token ?? null, {
			onMessage: (message) => {
				if (message.type === 'state') {
					hasPinPad = !!message.hasPinPad;
					hasTextInput = !!message.hasTextInput;
					canGoBack = !!message.canGoBack;
				}
			},
			onClose: () => (connected = false)
		})
			.then((result) => {
				if (cancelled) return;
				if (!result) {
					phase = 'not-paired';
					return;
				}
				session = result;
				connected = true;
				phase = 'ready';
				send({ type: 'requestState' });
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				errorMessage = err instanceof Error ? err.message : String(err);
				phase = 'error';
			});

		return () => {
			cancelled = true;
			session?.close();
		};
	});
</script>

<svelte:head><title>{m.remote_title()}</title></svelte:head>

<div
	class="flex h-dvh flex-col bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 text-white"
>
	{#if phase === 'ready'}
		<header class="flex items-center justify-between px-4 pt-4 pb-2">
			{#if canGoBack}
				<button
					type="button"
					onclick={goBack}
					class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					&larr; {m.back()}
				</button>
			{:else}
				<span></span>
			{/if}
			<span class="flex items-center gap-2 text-xs text-white/50">
				<span class="size-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-white/30'}"></span>
				{connected ? m.connected() : m.connecting()}
			</span>
		</header>

		<main class="flex flex-1 flex-col items-center justify-center px-6">
			{#if tab === 'trackpad'}
				<div
					role="application"
					aria-label={m.trackpad_label()}
					ontouchstart={onTouchStart}
					ontouchmove={onTouchMove}
					ontouchend={onTouchEnd}
					class="flex size-full max-h-96 w-full max-w-sm touch-none items-center justify-center rounded-3xl bg-white/12 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 select-none"
				>
					<p class="px-8 text-center text-sm text-white/40">{m.swipe_hint()}</p>
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
						placeholder={m.type_here_placeholder()}
						class="w-full rounded-full bg-white/12 px-6 py-4 text-center text-lg text-white placeholder-white/40 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
					/>
					<button
						type="submit"
						aria-label={m.enter()}
						class="w-full rounded-full bg-white px-6 py-4 text-lg font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
					>
						{m.enter()}
					</button>
				</form>
			{/if}
		</main>
	{:else if phase === 'connecting'}
		<main class="flex flex-1 flex-col items-center justify-center px-8 text-center">
			<p class="text-white/60">{m.connecting()}</p>
		</main>
	{:else if phase === 'not-paired'}
		<main class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
			<p class="text-lg font-medium text-white/90">{m.not_paired_title()}</p>
			<p class="max-w-xs text-sm text-white/50">{m.not_paired_description()}</p>
		</main>
	{:else}
		<main class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
			<p class="text-lg font-medium text-white/90">{m.pairing_error_title()}</p>
			<p class="max-w-xs text-sm text-white/50">{errorMessage}</p>
		</main>
	{/if}
</div>
