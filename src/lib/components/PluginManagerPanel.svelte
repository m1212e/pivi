<script lang="ts">
	// Installing a plugin and deciding, for each one, what it's allowed to do. The
	// body shared by the phone's sheet (PluginManager.svelte) and the TV's own page
	// (/plugins), which is driven with nothing but the remote's gestures — so
	// everything here works by moving focus and pressing: every control is a
	// button (a switch is a button, not a checkbox), text goes into ordinary
	// fields (the remote relays the phone's keyboard to whichever one has focus),
	// and nothing opens a native dialog that a remote could never answer.
	//
	// It sends nothing itself: whoever renders it passes the actions in.
	import { LoaderCircle, Trash2 } from '@lucide/svelte';
	import type { z } from 'zod';
	import type { pluginsStateParamsSchema } from '#lib/pairing/remoteProtocol';
	import type { PermissionKey } from '#lib/plugins/manifest';
	import * as m from '#lib/paraglide/messages';

	type PluginsState = z.infer<typeof pluginsStateParamsSchema>;
	type InstalledPlugin = PluginsState['plugins'][number];

	export type PluginActions = {
		preview: (image: string, publicKey: string) => void;
		install: (granted: PermissionKey[]) => void;
		dismissPreview: () => void;
		uninstall: (pluginId: string) => void;
		setEnabled: (pluginId: string, enabled: boolean) => void;
		setAutoUpdate: (pluginId: string, autoUpdate: boolean) => void;
		setPermission: (pluginId: string, permission: PermissionKey, granted: boolean) => void;
		approveUpdate: (pluginId: string) => void;
		rejectUpdate: (pluginId: string) => void;
		clearCache: (pluginId: string) => void;
		checkUpdates: () => void;
	};

	let { plugins, actions }: { plugins: PluginsState; actions: PluginActions } = $props();

	let image = $state('');
	let publicKey = $state('');
	// What the user has left switched on in the preview. Starts with everything the
	// plugin asks for; they turn off what they don't want to give.
	let chosen = $derived<PermissionKey[]>(plugins.preview ? [...plugins.preview.permissions] : []);
	// Removing a plugin deletes its data, so it asks first — here in the page, since
	// a native confirm() is something a remote can't answer.
	let confirmingUninstall = $state<string | null>(null);

	const permissionLabel = (key: PermissionKey) =>
		({
			network: m.plugins_perm_network(),
			storage: m.plugins_perm_storage(),
			cache: m.plugins_perm_cache()
		})[key];

	const permissionHint = (key: PermissionKey) =>
		({
			network: m.plugins_perm_network_hint(),
			storage: m.plugins_perm_storage_hint(),
			cache: m.plugins_perm_cache_hint()
		})[key];

	const busyLabel = $derived(
		plugins.busy &&
			{
				previewing: m.plugins_reviewing(),
				installing: m.plugins_installing(),
				checking: m.plugins_checking(),
				working: m.plugins_working()
			}[plugins.busy]
	);

	function toggleChosen(key: PermissionKey, on: boolean) {
		chosen = on ? [...chosen.filter((k) => k !== key), key] : chosen.filter((k) => k !== key);
	}

	let keyField = $state<HTMLTextAreaElement>();

	function review(event: SubmitEvent) {
		event.preventDefault();
		// A submit doesn't respect the button being disabled (the remote's Enter
		// submits the form directly), so an incomplete form is ignored here.
		if (!image.trim() || !publicKey.trim() || plugins.busy !== null) return;
		actions.preview(image.trim(), publicKey.trim());
	}

	// Enter after the image means "next", not "go": the key still has to be filled
	// in, and the remote's Enter would otherwise submit the half-filled form.
	function nextAfterImage(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		keyField?.focus();
	}

	// The short form of a key fingerprint is enough to recognise, not to compare.
	const shortFingerprint = (fingerprint: string) => `${fingerprint.slice(0, 16)}…`;

	const buttonBase =
		'rounded-2xl px-5 py-3 font-medium transition focus:outline-none disabled:opacity-50';
</script>

{#snippet toggle(label: string, on: boolean, onchange: (next: boolean) => void, hint?: string)}
	<button
		type="button"
		role="switch"
		aria-checked={on}
		onclick={() => onchange(!on)}
		class="flex w-full items-start gap-3 rounded-2xl px-1 py-2 text-left focus:outline-none"
	>
		<span
			data-focus-ring-target
			class="mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition {on
				? 'bg-indigo-500'
				: 'bg-white/20'}"
		>
			<span class="size-5 rounded-full bg-white shadow transition {on ? 'translate-x-5' : ''}"
			></span>
		</span>
		<span class="min-w-0 flex-1">
			<span class="block text-white/90">{label}</span>
			{#if hint}<span class="block text-sm text-white/50">{hint}</span>{/if}
		</span>
	</button>
{/snippet}

{#snippet domainList(domains: string[])}
	<ul class="mt-1 flex flex-wrap gap-1.5 pl-14">
		{#each domains as domain (domain)}
			<li class="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-xs text-white/70">
				{domain}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet preview(p: NonNullable<PluginsState['preview']>)}
	<section class="flex flex-col gap-3 rounded-3xl bg-white/10 p-4 ring-1 ring-white/20">
		<h3 class="text-lg font-semibold text-white/90">
			{m.plugins_preview_title({ name: p.name, version: p.version })}
		</h3>
		<p class="font-mono text-xs break-all text-white/50">{p.image}</p>
		<p class="text-sm text-emerald-300/90">
			{m.plugins_signed_by({ fingerprint: shortFingerprint(p.signerFingerprint) })}
		</p>
		{#if p.conflict}
			<p class="rounded-2xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
				{m.plugins_conflict()}
			</p>
		{/if}

		<div>
			<h4 class="text-sm font-medium text-white/70">{m.plugins_permissions()}</h4>
			{#each p.permissions as key (key)}
				{@render toggle(
					permissionLabel(key),
					chosen.includes(key),
					(on) => toggleChosen(key, on),
					permissionHint(key)
				)}
				{#if key === 'network'}{@render domainList(p.domains)}{/if}
			{/each}
		</div>

		<div class="flex gap-2">
			<button
				type="button"
				disabled={p.conflict || plugins.busy !== null}
				onclick={() => {
					actions.install(chosen);
					// What was typed has been used; the form starts empty for the next one.
					image = '';
					publicKey = '';
				}}
				class="flex-1 bg-indigo-500 text-white hover:bg-indigo-400 {buttonBase}"
			>
				{m.plugins_install()}
			</button>
			<button
				type="button"
				onclick={actions.dismissPreview}
				class="bg-white/12 text-white/80 hover:bg-white/20 {buttonBase}"
			>
				{m.plugins_cancel()}
			</button>
		</div>
	</section>
{/snippet}

{#snippet installForm()}
	<form onsubmit={review} class="flex flex-col gap-3">
		<h3 class="text-sm font-medium text-white/70">{m.plugins_install_heading()}</h3>
		<label class="flex flex-col gap-1 text-sm text-white/60">
			{m.plugins_image_label()}
			<input
				type="text"
				bind:value={image}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="next"
				onkeydown={nextAfterImage}
				placeholder={m.plugins_image_placeholder()}
				class="rounded-2xl bg-white/12 px-4 py-3 font-mono text-sm text-white placeholder-white/30 ring-1 ring-white/25 focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-white/60">
			{m.plugins_key_label()}
			<textarea
				bind:this={keyField}
				bind:value={publicKey}
				rows="4"
				autocapitalize="off"
				spellcheck="false"
				placeholder="-----BEGIN PUBLIC KEY-----"
				class="rounded-2xl bg-white/12 px-4 py-3 font-mono text-xs text-white placeholder-white/30 ring-1 ring-white/25 focus:outline-none"
			></textarea>
		</label>
		<button
			type="submit"
			disabled={!image.trim() || !publicKey.trim() || plugins.busy !== null}
			class="bg-white/12 text-white/85 ring-1 ring-white/25 hover:bg-white/20 {buttonBase}"
		>
			{m.plugins_review()}
		</button>
	</form>
{/snippet}

{#snippet pendingUpdate(plugin: InstalledPlugin, update: NonNullable<InstalledPlugin['update']>)}
	<div class="rounded-2xl bg-indigo-500/15 p-3 ring-1 ring-indigo-400/30">
		<p class="text-sm text-indigo-100">{m.plugins_update_available({ version: update.version })}</p>
		{#if update.addedPermissions.length > 0 || update.addedDomains.length > 0}
			<p class="mt-2 text-sm text-white/60">{m.plugins_update_adds()}</p>
			<ul class="mt-1 list-disc pl-5 text-sm text-white/80">
				{#each update.addedPermissions as key (key)}
					<li>{permissionLabel(key)}</li>
				{/each}
			</ul>
			{#if update.addedDomains.length > 0}{@render domainList(update.addedDomains)}{/if}
		{/if}
		<div class="mt-3 flex gap-2">
			<button
				type="button"
				onclick={() => actions.approveUpdate(plugin.id)}
				class="flex-1 bg-indigo-500 text-white {buttonBase}"
			>
				{m.plugins_approve()}
			</button>
			<button
				type="button"
				onclick={() => actions.rejectUpdate(plugin.id)}
				class="bg-white/12 text-white/80 {buttonBase}"
			>
				{m.plugins_reject()}
			</button>
		</div>
	</div>
{/snippet}

{#snippet removeControls(plugin: InstalledPlugin)}
	{#if confirmingUninstall === plugin.id}
		<p class="flex-1 self-center text-sm text-red-200">
			{m.plugins_uninstall_confirm({ name: plugin.name })}
		</p>
		<button
			type="button"
			onclick={() => {
				confirmingUninstall = null;
				actions.uninstall(plugin.id);
			}}
			class="flex items-center gap-1.5 bg-red-500/80 text-white {buttonBase}"
		>
			<Trash2 class="size-4" />
			{m.plugins_uninstall()}
		</button>
		<button
			type="button"
			onclick={() => (confirmingUninstall = null)}
			class="bg-white/12 text-white/80 {buttonBase}"
		>
			{m.plugins_cancel()}
		</button>
	{:else}
		<button
			type="button"
			onclick={() => (confirmingUninstall = plugin.id)}
			class="ml-auto flex items-center gap-1.5 bg-red-500/15 text-red-200 {buttonBase}"
		>
			<Trash2 class="size-4" />
			{m.plugins_uninstall()}
		</button>
	{/if}
{/snippet}

{#snippet installed(plugin: InstalledPlugin)}
	<li class="flex flex-col gap-1 rounded-3xl bg-white/10 p-4 ring-1 ring-white/15">
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="truncate text-lg font-semibold text-white/90">{plugin.name}</h3>
			<span class="shrink-0 text-xs text-white/40">{plugin.version}</span>
		</div>
		<p class="font-mono text-xs break-all text-white/40">{plugin.image}</p>

		{@render toggle(m.plugins_enabled(), plugin.enabled, (on) => actions.setEnabled(plugin.id, on))}
		{@render toggle(m.plugins_auto_update(), plugin.autoUpdate, (on) =>
			actions.setAutoUpdate(plugin.id, on)
		)}

		{#if plugin.permissions.length > 0}
			<h4 class="mt-1 text-sm font-medium text-white/70">{m.plugins_permissions()}</h4>
			{#each plugin.permissions as permission (permission.key)}
				{@render toggle(
					permissionLabel(permission.key),
					permission.granted,
					(on) => actions.setPermission(plugin.id, permission.key, on),
					permissionHint(permission.key)
				)}
				{#if permission.key === 'network'}{@render domainList(plugin.domains)}{/if}
			{/each}
		{/if}

		{#if plugin.update}{@render pendingUpdate(plugin, plugin.update)}{/if}
		{#if plugin.error}
			<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200">{plugin.error}</p>
		{/if}

		<div class="mt-2 flex flex-wrap gap-2">
			{#if plugin.permissions.some((p) => p.key === 'cache' && p.granted)}
				<button
					type="button"
					onclick={() => actions.clearCache(plugin.id)}
					class="bg-white/12 text-white/80 {buttonBase}"
				>
					{m.plugins_clear_cache()}
				</button>
			{/if}
			{@render removeControls(plugin)}
		</div>
	</li>
{/snippet}

<div class="flex flex-col gap-5">
	{#if busyLabel}
		<p class="flex items-center gap-2 text-sm text-white/60">
			<LoaderCircle class="size-4 animate-spin" />
			{busyLabel}
		</p>
	{/if}
	{#if plugins.error}
		<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
			{plugins.error}
		</p>
	{/if}

	{#if plugins.preview}
		{@render preview(plugins.preview)}
	{:else}
		{@render installForm()}
	{/if}

	{#if plugins.plugins.length === 0}
		<p class="text-center text-sm text-white/40">{m.plugins_none()}</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each plugins.plugins as plugin (plugin.id)}
				{@render installed(plugin)}
			{/each}
		</ul>
		<button
			type="button"
			disabled={plugins.busy !== null}
			onclick={actions.checkUpdates}
			class="bg-white/12 text-white/85 ring-1 ring-white/25 hover:bg-white/20 {buttonBase}"
		>
			{m.plugins_check_updates()}
		</button>
	{/if}
</div>
