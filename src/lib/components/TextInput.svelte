<script lang="ts">
	import { DOM_EVENTS } from '#lib/domEvents';
	import { onDestroy } from 'svelte';
	import { osk } from '#lib/state/osk.svelte';
	import Button from './Button.svelte';
	import TextField from './TextField.svelte';

	// A complete text entry for apps (see UiNodeRenderer): TextField plus submit,
	// debounced input reporting and keyboard suggestions. TextField stays the
	// bare field so other screens can build their own forms around it.
	let {
		label,
		placeholder,
		secret = false,
		search = false,
		suggestions = [],
		onInput,
		onSubmit
	}: {
		label: string;
		placeholder?: string;
		secret?: boolean;
		search?: boolean;
		suggestions?: string[];
		onInput?: (value: string) => void;
		onSubmit: (value: string) => void;
	} = $props();

	let value = $state('');
	let input: HTMLInputElement | HTMLTextAreaElement | undefined = $state();
	let field: TextField | undefined = $state();
	let form: HTMLFormElement | undefined = $state();

	// Typing bursts would otherwise ask the app for suggestions on every key.
	let inputTimer: ReturnType<typeof setTimeout> | undefined;
	function reportInput(text: string) {
		if (!onInput) return;
		clearTimeout(inputTimer);
		inputTimer = setTimeout(() => onInput(text), 200);
	}

	// The on-screen keyboard shows these, so they are handed over while the
	// input is the field being typed into.
	$effect(() => {
		if (!input) return;
		osk.suggestions = { owner: input, items: suggestions };
		return () => {
			if (osk.suggestions.owner === input) osk.suggestions = { owner: null, items: [] };
		};
	});

	$effect(() => {
		input?.addEventListener(DOM_EVENTS.suggestion, pickSuggestion);
		return () => input?.removeEventListener(DOM_EVENTS.suggestion, pickSuggestion);
	});

	onDestroy(() => clearTimeout(inputTimer));

	// A suggestion picked on the TV keyboard or the phone submits right away,
	// since picking one means that's what the user wants.
	function pickSuggestion(event: Event) {
		value = (event as CustomEvent<string>).detail;
		form?.requestSubmit();
	}
</script>

<form
	bind:this={form}
	class="flex gap-2"
	onsubmit={(e) => {
		e.preventDefault();
		onSubmit(value);
		if (search) void field?.stop();
	}}
>
	<TextField
		bind:this={field}
		bind:value
		bind:input
		{label}
		{placeholder}
		{secret}
		{search}
		enterkeyhint={search ? 'search' : 'go'}
		oninput={reportInput}
	/>
	{#if !search}
		<Button type="submit" variant="solid">Go</Button>
	{/if}
</form>
