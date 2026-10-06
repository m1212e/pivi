<script lang="ts">
	import { tick } from 'svelte';

	let {
		value = $bindable(''),
		label,
		placeholder,
		secret = false,
		search = false,
		multiline = false,
		rows = 4,
		mono = false,
		center = false,
		autocomplete = 'off',
		enterkeyhint = 'go',
		class: className = 'rounded-full bg-white/12 px-4 py-2 text-sm',
		input = $bindable(),
		oninput,
		onblur,
		onEnter
	}: {
		value?: string;
		label: string;
		placeholder?: string;
		secret?: boolean;
		search?: boolean;
		multiline?: boolean;
		rows?: number;
		mono?: boolean;
		center?: boolean;
		autocomplete?: AutoFill;
		enterkeyhint?: 'go' | 'next' | 'search' | 'done' | 'enter' | 'send';
		// Shape and spacing of the box around the field.
		class?: string;
		input?: HTMLInputElement | HTMLTextAreaElement;
		oninput?: (value: string) => void;
		// Editing ended, by blur, Escape or a finished edit.
		onblur?: () => void;
		// Enter on a single line field. Call preventDefault to keep it from
		// submitting an enclosing form.
		onEnter?: (event: KeyboardEvent) => void;
	} = $props();

	let editing = $state(false);
	let trigger: HTMLButtonElement | undefined = $state();

	// Focusing the field right away would pop the remote keyboard open just by
	// moving past it, so editing only starts on an explicit select.
	async function edit() {
		editing = true;
		await tick();
		input?.focus();
	}

	/** Ends editing and puts focus back on the field's resting button. */
	export async function stop() {
		if (!editing) return;
		editing = false;
		onblur?.();
		await tick();
		trigger?.focus();
	}

	/** Moves focus to the field without opening the keyboard. */
	export function focus() {
		if (editing) input?.focus();
		else trigger?.focus();
	}

	/** Starts editing right away, for fields opened by an explicit action. */
	export function startEditing() {
		return edit();
	}

	const shown = $derived(
		value ? (secret ? '•'.repeat(value.length) : value) : (placeholder ?? label)
	);

	const fieldClass = $derived(
		`w-full min-w-0 bg-transparent placeholder-white/40 outline-none! ${mono ? 'font-mono' : ''} ${center ? 'text-center' : ''}`
	);

	function handleBlur(e: FocusEvent) {
		// Focus moving onto the on-screen keyboard is still editing.
		if (e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-pivi-osk]')) return;
		editing = false;
		onblur?.();
	}

	// fallow-ignore-next-line complexity
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') void stop();
		else if (e.key === 'Enter' && !multiline) onEnter?.(e);
	}
	const inputType = $derived(secret ? 'password' : search ? 'search' : 'text');
	const alignClass = $derived(multiline ? 'items-start' : 'items-center');
	const triggerClass = $derived(
		[
			multiline ? 'text-left break-all whitespace-pre-wrap' : 'truncate',
			center ? 'text-center' : 'text-left',
			mono && 'font-mono',
			value ? 'text-white' : 'text-white/40'
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<div
	class="flex w-full gap-2 text-white has-[.pivi-remote-focus]:outline-3 has-[.pivi-remote-focus]:outline-offset-3 has-[.pivi-remote-focus]:outline-white {alignClass} {className}"
>
	{#if search}
		<svg viewBox="0 0 24 24" class="size-5 shrink-0 fill-white/60" aria-hidden="true">
			<path
				d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
			/>
		</svg>
	{/if}
	{#if editing}
		{#if multiline}
			<textarea
				bind:this={input}
				bind:value
				{rows}
				{placeholder}
				aria-label={label}
				autocapitalize="off"
				spellcheck="false"
				oninput={(e) => oninput?.(e.currentTarget.value)}
				onblur={handleBlur}
				onkeydown={handleKeydown}
				class="resize-none {fieldClass}"></textarea>
		{:else}
			<input
				bind:this={input}
				bind:value
				type={inputType}
				{enterkeyhint}
				{autocomplete}
				autocapitalize="off"
				spellcheck="false"
				{placeholder}
				aria-label={label}
				oninput={(e) => oninput?.(e.currentTarget.value)}
				onblur={handleBlur}
				onkeydown={handleKeydown}
				class={fieldClass}
			/>
		{/if}
	{:else}
		<button
			bind:this={trigger}
			type="button"
			aria-label={label}
			onclick={edit}
			style:min-height={multiline ? `${rows * 1.5}em` : undefined}
			class="w-full min-w-0 outline-none! {triggerClass}"
		>
			{shown}
		</button>
	{/if}
</div>
