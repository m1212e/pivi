<script lang="ts">
	import { KeyboardOff } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';

	// More than this don't fit above the input on a phone anyway.
	const MAX_SUGGESTIONS = 6;

	let {
		text = $bindable(),
		suggestions,
		onInput,
		onSubmit,
		onExit,
		onPickSuggestion
	}: {
		text: string;
		suggestions: string[];
		onInput: () => void;
		onSubmit: () => void;
		onExit: () => void;
		onPickSuggestion: (value: string) => void;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	$effect(() => input?.focus());
</script>

<form
	onsubmit={(event) => {
		event.preventDefault();
		onSubmit();
	}}
	class="flex w-full max-w-sm flex-col items-center gap-3"
>
	{#if suggestions.length > 0}
		<div class="flex w-full flex-wrap justify-center gap-2" aria-label={m.osk_suggestions()}>
			{#each suggestions.slice(0, MAX_SUGGESTIONS) as suggestion (suggestion)}
				<button
					type="button"
					onclick={() => onPickSuggestion(suggestion)}
					class="max-w-full rounded-full bg-white/12 px-4 py-2 text-sm text-white/90 ring-1 ring-white/25 transition hover:bg-white/20 focus:outline-none"
				>
					<span class="block truncate">{suggestion}</span>
				</button>
			{/each}
		</div>
	{/if}
	<input
		bind:this={input}
		bind:value={text}
		oninput={onInput}
		enterkeyhint="go"
		placeholder={m.type_here_placeholder()}
		class="w-full rounded-full bg-white/12 px-6 py-4 text-center text-lg text-white placeholder-white/40 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 focus:outline-none"
	/>
	<div class="flex w-full gap-3">
		<button
			type="button"
			onclick={onExit}
			aria-label={m.exit_text_entry()}
			class="flex shrink-0 items-center justify-center rounded-full bg-white/12 px-5 py-4 text-white/80 ring-1 ring-white/25 transition hover:bg-white/20 focus:outline-none"
		>
			<KeyboardOff class="size-6" />
		</button>
		<button
			type="submit"
			aria-label={m.enter()}
			class="flex-1 rounded-full bg-white px-6 py-4 text-lg font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none"
		>
			{m.enter()}
		</button>
	</div>
</form>
