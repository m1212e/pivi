<script lang="ts">
	import { Languages } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import { getLocale, locales, setLocale, type Locale } from '#lib/paraglide/runtime';
	import Select from '#lib/components/Select.svelte';

	// Built on Select so the language list is reachable by remote like any other
	// choice.
	let { placement = 'below' }: { placement?: 'above' | 'below' } = $props();

	let value = $state<Locale>(getLocale());

	// Each language shown in its own tongue so it stays findable after
	// switching to one the viewer can't read.
	const name = (locale: Locale) => {
		const label = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
		return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
	};
</script>

<Select bind:value options={locales} label={m.language()} {placement} onChange={setLocale}>
	{#snippet option(locale: Locale)}
		<span class="flex items-center gap-2">
			<Languages class="size-3.5 shrink-0" />
			{name(locale)}
		</span>
	{/snippet}
</Select>
