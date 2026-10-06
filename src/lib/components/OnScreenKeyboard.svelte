<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { ArrowBigUp, CornerDownLeft, Delete } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import {
		DEAD_SPACING,
		EURKEY_ROWS,
		layerIndex,
		type Cell,
		type KeyLayers,
		type DeadKind
	} from '#lib/keyboard/eurkey';
	import { dismissKeyboard, keyboardVisible, osk } from '#lib/state/osk.svelte';
	import { deleteBackward, insertText, submitInput } from '#lib/textEntry';
	import {
		cycleModifier,
		focusWasDropped,
		physicalKeyAction,
		pressCellResult,
		reclaimFocus,
		resolveFocus,
		type Modifier
	} from '#lib/keyboard/oskLogic';

	const visible = $derived(keyboardVisible());
	let root: HTMLElement | undefined = $state();

	let shift = $state<Modifier>('off');
	let altGr = $state<Modifier>('off');
	// An accent key waiting for the letter it goes on.
	let dead = $state<DeadKind | null>(null);
	const layer = $derived(layerIndex(shift !== 'off', altGr !== 'off'));

	const suggestions = $derived(
		osk.suggestions.owner && osk.suggestions.owner === osk.target ? osk.suggestions.items : []
	);

	const enterLabel = $derived(
		osk.target?.enterKeyHint === 'search'
			? m.osk_search()
			: osk.target?.enterKeyHint === 'done'
				? m.osk_done()
				: m.osk_go()
	);

	function type(text: string) {
		if (osk.target) insertText(osk.target, text);
	}

	function afterKey() {
		if (shift === 'once') shift = 'off';
		if (altGr === 'once') altGr = 'off';
	}

	function pressCell(cell: Cell) {
		const press = pressCellResult(dead, cell);
		if (press.text !== null) type(press.text);
		dead = press.dead;
		afterKey();
	}

	function pressSpace() {
		pressCell(' ');
	}

	function backspace() {
		if (dead) dead = null;
		else if (osk.target) deleteBackward(osk.target);
	}

	function pressEnter() {
		const target = osk.target;
		if (!target) return;
		if (target instanceof HTMLTextAreaElement) type('\n');
		else submitInput(target);
	}

	function pick(text: string) {
		osk.target?.dispatchEvent(new CustomEvent('pivi-suggestion', { detail: text }));
	}

	// Holding backspace repeats, since a long field is otherwise a lot of
	// presses. The remote sends a real pointerdown and pointerup around a hold,
	// then a click, which the hold has to swallow so it does not delete once more.
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let repeatTimer: ReturnType<typeof setInterval> | undefined;
	let swallowClick = false;

	function startHold() {
		swallowClick = false;
		clearHold();
		holdTimer = setTimeout(() => {
			swallowClick = true;
			repeatTimer = setInterval(backspace, 70);
		}, 450);
	}

	function clearHold() {
		clearTimeout(holdTimer);
		clearInterval(repeatTimer);
	}

	function onBackspaceClick() {
		if (swallowClick) {
			swallowClick = false;
			return;
		}
		backspace();
	}

	function onFocusIn(event: FocusEvent) {
		const el = event.target;
		if (!(el instanceof Element) || root?.contains(el)) return;
		const next = resolveFocus(el, osk.dismissed);
		osk.target = next.target;
		osk.dismissed = next.dismissed;
	}

	// Focus can drop to <body> with no focusin to react to, e.g. a click on
	// empty space.
	function onFocusOut(event: FocusEvent) {
		if (event.relatedTarget) return;
		setTimeout(() => {
			if (!focusWasDropped(osk.target, document.activeElement, root)) return;
			osk.target = null;
			osk.dismissed = null;
		}, 0);
	}

	// Lets a physical keyboard keep working while focus sits on the keys.
	function onKeyDown(event: KeyboardEvent) {
		if (!root?.contains(document.activeElement)) return;
		const action = physicalKeyAction(event);
		if (!action) return;
		event.preventDefault();
		const run = { dismiss: dismissKeyboard, backspace, type: () => type(event.key) };
		run[action]();
	}

	onMount(() => {
		// Removing the field while typing (a page change) leaves nothing to type into.
		const observer = new MutationObserver(() => {
			if (osk.target && !osk.target.isConnected) osk.target = null;
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			clearHold();
		};
	});

	// A field popping up, or the phone handing typing over to the TV, puts
	// focus on the keys so the remote can start typing right away.
	$effect(() => {
		if (!visible) return;
		void tick().then(() => {
			if (!root || root.contains(document.activeElement)) return;
			root.querySelector<HTMLElement>('[data-osk-start]')?.focus();
		});
	});

	// The phone taking over while focus is on a key would leave focus nowhere.
	$effect(() => {
		if (!visible) reclaimFocus(osk.target);
	});

	$effect(() => {
		if (visible) return;
		shift = 'off';
		altGr = 'off';
		dead = null;
	});

	const KEY =
		'flex h-14 min-w-14 items-center justify-center rounded-xl px-2 text-xl font-medium transition focus:outline-none';
	const SOFT = 'bg-white/12 text-white hover:bg-white/20';
	const ACTIVE = 'bg-white text-slate-950';
</script>

<svelte:document onfocusin={onFocusIn} onfocusout={onFocusOut} onkeydown={onKeyDown} />

{#snippet suggestionBar()}
	{#if suggestions.length > 0}
		<div class="flex flex-wrap gap-2.5" aria-label={m.osk_suggestions()}>
			{#each suggestions.slice(0, 6) as suggestion (suggestion)}
				<button
					type="button"
					onclick={() => pick(suggestion)}
					class="{KEY} {SOFT} h-12 max-w-[22rem] px-5 text-lg"
				>
					<span class="truncate">{suggestion}</span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet shiftKey()}
	<button
		type="button"
		aria-label={m.osk_shift()}
		aria-pressed={shift !== 'off'}
		onclick={() => (shift = cycleModifier(shift))}
		class="{KEY} w-24 {shift === 'off' ? SOFT : ACTIVE}"
	>
		<ArrowBigUp class="size-6" fill={shift === 'lock' ? 'currentColor' : 'none'} />
	</button>
{/snippet}

{#snippet backspaceKey()}
	<button
		type="button"
		aria-label={m.osk_backspace()}
		onclick={onBackspaceClick}
		onpointerdown={startHold}
		onpointerup={clearHold}
		onpointercancel={clearHold}
		onpointerleave={clearHold}
		class="{KEY} {SOFT} w-24"
	>
		<Delete class="size-6" />
	</button>
{/snippet}

{#snippet enterKey()}
	<button
		type="button"
		onclick={pressEnter}
		class="{KEY} {ACTIVE} min-w-28 gap-2 px-5 hover:bg-white/90"
	>
		{enterLabel}
		<CornerDownLeft class="size-5" />
	</button>
{/snippet}

{#snippet altGrKey()}
	<button
		type="button"
		aria-pressed={altGr !== 'off'}
		onclick={() => (altGr = cycleModifier(altGr))}
		class="{KEY} w-24 text-base {altGr === 'off' ? SOFT : ACTIVE}"
	>
		AltGr{altGr === 'lock' ? ' ·' : ''}
	</button>
{/snippet}

{#snippet cellKey(cell: Cell, start: boolean)}
	<button
		type="button"
		onclick={() => pressCell(cell)}
		data-osk-start={start ? '' : undefined}
		class="{KEY} {typeof cell !== 'string' && dead === cell.dead ? ACTIVE : SOFT}"
	>
		{typeof cell === 'string' ? cell : DEAD_SPACING[cell.dead]}
	</button>
{/snippet}

{#snippet keyRow(row: KeyLayers[], r: number)}
	<div class="flex justify-center gap-2.5">
		{#if r === 3}
			{@render shiftKey()}
		{/if}
		{#each row as key, c (c)}
			{@render cellKey(key[layer], r === 2 && c === 4)}
		{/each}
		{#if r === 0}
			{@render backspaceKey()}
		{:else if r === 2}
			{@render enterKey()}
		{:else if r === 3}
			{@render altGrKey()}
		{/if}
	</div>
{/snippet}

{#if visible}
	<div
		bind:this={root}
		role="group"
		aria-label={m.osk_label()}
		data-pivi-osk
		data-pivi-sticky
		transition:fly={{ y: 48, duration: 250 }}
		class="fixed bottom-8 left-1/2 z-40 flex w-fit max-w-[96vw] -translate-x-1/2 flex-col gap-2.5 rounded-3xl bg-white/12 p-4 text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
	>
		{@render suggestionBar()}

		{#each EURKEY_ROWS as row, r (r)}
			{@render keyRow(row, r)}
		{/each}

		<div class="flex gap-2.5">
			<button type="button" onclick={() => dismissKeyboard()} class="{KEY} {SOFT} w-32 text-lg">
				{m.osk_done()}
			</button>
			<button
				type="button"
				aria-label={m.osk_space()}
				onclick={pressSpace}
				class="{KEY} {SOFT} flex-1"
			></button>
		</div>
	</div>
{/if}
