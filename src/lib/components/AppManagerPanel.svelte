<script lang="ts">
	// Installing an app and deciding, for each one, what it's allowed to do. The
	// TV's own page (/apps), driven with nothing but the remote's gestures — so
	// everything here works by moving focus and pressing: every control is a
	// button (a switch is a button, not a checkbox), text goes into ordinary
	// fields (the remote relays the phone's keyboard to whichever one has focus),
	// and nothing opens a native dialog that a remote could never answer.
	//
	// It sends nothing itself: whoever renders it passes the actions in.
	import {
		ChevronDown,
		Eraser,
		LoaderCircle,
		RefreshCw,
		Recycle,
		SquarePlay,
		Trash2
	} from '@lucide/svelte';
	import { fade, fly, scale, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { AppsState } from '#lib/apps/management';
	import { appIconDataUrl, type PermissionKey } from '#lib/apps/manifest';
	import { appAccentGradient } from '#lib/appAccent';
	import HoldToConfirmButton from './HoldToConfirmButton.svelte';
	import TextField from './TextField.svelte';
	import * as m from '#lib/paraglide/messages';

	type InstalledApp = AppsState['apps'][number];

	export type AppActions = {
		// `publicKey` is left out to install without signature verification.
		preview: (image: string, publicKey?: string) => void;
		install: (granted: PermissionKey[]) => void;
		dismissPreview: () => void;
		uninstall: (appId: string) => void;
		setEnabled: (appId: string, enabled: boolean) => void;
		setAutoUpdate: (appId: string, autoUpdate: boolean) => void;
		setPermission: (appId: string, permission: PermissionKey, granted: boolean) => void;
		approveUpdate: (appId: string) => void;
		rejectUpdate: (appId: string) => void;
		clearCache: (appId: string) => void;
		clearStorage: (appId: string) => void;
		checkUpdates: () => void;
	};

	type SuggestedApp = {
		id: string;
		name: string;
		description: string;
		icon: string | null;
		image: string;
		publicKey: string | null;
	};

	let {
		apps,
		actions,
		suggested = []
	}: { apps: AppsState; actions: AppActions; suggested?: SuggestedApp[] } = $props();

	let image = $state('');
	let publicKey = $state('');
	// Off by default: most installs here are a build someone's trying out, not
	// yet a signed release, so skipping verification is the path that needs no
	// extra tap. Switching it on reveals the key field; leaving it off sends no
	// `publicKey` at all, not an empty one.
	let verifySignature = $state(false);
	// What the user has left switched on in the preview. Starts with everything the
	// app asks for; they turn off what they don't want to give.
	let chosen = $derived<PermissionKey[]>(apps.preview ? [...apps.preview.permissions] : []);
	// Installed apps render as a compact row; its settings (toggles,
	// permissions, actions) only show for whichever one is expanded, so a
	// list of several apps doesn't turn into a wall of switches.
	let expandedAppId = $state<string | null>(null);

	// A suggested app that's already installed has nothing left to offer --
	// tapping it would just preview-install over the real thing. Filtered
	// here rather than left for the user to notice it does nothing.
	const visibleSuggested = $derived(
		suggested.filter((entry) => !apps.apps.some((app) => app.id === entry.id))
	);

	const permissionLabel = (key: PermissionKey) =>
		({
			network: m.apps_perm_network(),
			storage: m.apps_perm_storage(),
			cache: m.apps_perm_cache()
		})[key];

	const permissionHint = (key: PermissionKey) =>
		({
			network: m.apps_perm_network_hint(),
			storage: m.apps_perm_storage_hint(),
			cache: m.apps_perm_cache_hint()
		})[key];

	const busyLabel = $derived(
		apps.busy &&
			{
				previewing: m.apps_reviewing(),
				installing: m.apps_installing(),
				checking: m.apps_checking(),
				working: m.apps_working()
			}[apps.busy]
	);

	// What the last "Check for updates" run actually found -- shown once
	// `busy` clears, otherwise a check that finds nothing to do (or that
	// silently applies one, for an app whose version string doesn't change
	// between builds) looks indistinguishable from the button not doing
	// anything at all.
	const checkSummaryText = $derived.by(() => {
		const summary = apps.lastCheckSummary;
		if (!summary || apps.busy) return null;
		const nameOf = (id: string) => apps.apps.find((a) => a.id === id)?.name ?? id;
		if (
			summary.applied.length === 0 &&
			summary.pending.length === 0 &&
			summary.failed.length === 0
		) {
			return m.apps_check_summary_none();
		}
		const parts = [
			summary.applied.length > 0
				? m.apps_check_summary_applied({ apps: summary.applied.map(nameOf).join(', ') })
				: null,
			summary.pending.length > 0
				? m.apps_check_summary_pending({ apps: summary.pending.map(nameOf).join(', ') })
				: null,
			summary.failed.length > 0
				? m.apps_check_summary_failed({ apps: summary.failed.map(nameOf).join(', ') })
				: null
		];
		return parts.filter((part) => part !== null).join(' ');
	});

	function toggleChosen(key: PermissionKey, on: boolean) {
		chosen = on ? [...chosen.filter((k) => k !== key), key] : chosen.filter((k) => k !== key);
	}

	let keyField = $state<TextField>();

	function review(event: SubmitEvent) {
		event.preventDefault();
		// A submit doesn't respect the button being disabled (the remote's Enter
		// submits the form directly), so an incomplete form is ignored here.
		if (!image.trim() || (verifySignature && !publicKey.trim()) || apps.busy !== null) return;
		actions.preview(image.trim(), verifySignature ? publicKey.trim() : undefined);
	}

	// Enter after the image means "next", not "go", when the key is still to be
	// filled in -- with verification off there's nothing left to fill, so Enter
	// is left to submit the form like it would anywhere else.
	function nextAfterImage(event: KeyboardEvent) {
		if (!verifySignature) return;
		event.preventDefault();
		keyField?.focus();
	}

	// The short form of a key fingerprint is enough to recognise, not to compare.
	const shortFingerprint = (fingerprint: string) => `${fingerprint.slice(0, 16)}…`;

	const buttonBase =
		'rounded-2xl px-5 py-3 font-medium transition focus:outline-none disabled:opacity-50';

	const appHasClearCache = (app: InstalledApp) =>
		app.permissions.some((p) => p.key === 'cache' && p.granted);
	const appHasClearStorage = (app: InstalledApp) =>
		app.permissions.some((p) => p.key === 'storage' && p.granted);
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
			class="mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 shadow-inner ring-1 backdrop-blur-xl backdrop-saturate-150 transition-colors duration-300 {on
				? 'bg-indigo-500/40 shadow-indigo-900/30 ring-indigo-300/40'
				: 'bg-white/10 shadow-black/20 ring-white/20'}"
		>
			<span
				class="size-5 rounded-full bg-gradient-to-b from-white to-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.35),inset_0_1px_1px_rgba(255,255,255,0.9)] ring-1 ring-black/5 transition-transform duration-300 ease-out {on
					? 'translate-x-5'
					: ''}"
			></span>
		</span>
		<span class="min-w-0 flex-1">
			<span class="block text-white/90">{label}</span>
			{#if hint}<span class="block text-sm text-white/50">{hint}</span>{/if}
		</span>
	</button>
{/snippet}

{#snippet appBadge(
	id: string,
	name: string,
	icon: string | null,
	primaryColor: string | null,
	secondaryColor: string | null
)}
	<span
		class="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white/90 uppercase"
		style="background: {appAccentGradient(id, primaryColor, secondaryColor)}"
	>
		{#if icon}
			<img src={appIconDataUrl(icon)} alt="" class="size-6 object-contain" />
		{:else}
			{name.slice(0, 1)}
		{/if}
	</span>
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

{#snippet preview(p: NonNullable<AppsState['preview']>)}
	<section class="flex flex-col gap-3 rounded-3xl bg-white/10 p-4 ring-1 ring-white/20">
		<div class="flex items-center gap-3">
			{@render appBadge(p.name, p.name, p.icon, p.primaryColor, p.secondaryColor)}
			<h3 class="text-lg font-semibold text-white/90">
				{m.apps_preview_title({ name: p.name, version: p.version })}
			</h3>
		</div>
		<p class="font-mono text-xs break-all text-white/50">{p.image}</p>
		{#if p.signerFingerprint}
			<p class="text-sm text-emerald-300/90">
				{m.apps_signed_by({ fingerprint: shortFingerprint(p.signerFingerprint) })}
			</p>
		{:else}
			<p class="text-sm text-amber-300/90">{m.apps_unsigned()}</p>
		{/if}
		{#if p.conflict}
			<p class="rounded-2xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
				{m.apps_conflict()}
			</p>
		{/if}

		<div>
			<h4 class="text-sm font-medium text-white/70">{m.apps_permissions()}</h4>
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
				disabled={p.conflict || apps.busy !== null}
				onclick={() => {
					actions.install(chosen);
					// What was typed has been used; the form starts empty for the next one.
					image = '';
					publicKey = '';
				}}
				class="flex-1 bg-indigo-500 text-white hover:bg-indigo-400 {buttonBase}"
			>
				{m.apps_install()}
			</button>
			<button
				type="button"
				onclick={actions.dismissPreview}
				class="bg-white/12 text-white/80 hover:bg-white/20 {buttonBase}"
			>
				{m.apps_cancel()}
			</button>
		</div>
	</section>
{/snippet}

{#snippet suggestedList()}
	<div class="flex flex-col gap-2">
		<h3 class="text-sm font-medium text-white/70">{m.apps_suggested_heading()}</h3>
		<ul class="flex flex-col gap-2">
			{#each visibleSuggested as entry, i (entry.id)}
				<li in:fly|global={{ y: 16, duration: 350, delay: i * 60, easing: quintOut }}>
					<button
						type="button"
						disabled={apps.busy !== null}
						onclick={() => actions.preview(entry.image, entry.publicKey ?? undefined)}
						class="flex w-full items-center gap-3 rounded-2xl bg-white/12 px-4 py-2.5 text-left ring-1 ring-white/25 transition hover:scale-[1.02] hover:bg-white/20 active:scale-[0.98] {buttonBase}"
					>
						{#if entry.icon}
							<img
								src={appIconDataUrl(entry.icon)}
								alt=""
								class="size-6 shrink-0 rounded-md object-contain"
							/>
						{:else}
							<SquarePlay class="size-6 shrink-0 text-white/70" />
						{/if}
						<span class="flex min-w-0 flex-col gap-0.5">
							<span class="text-white/90">{entry.name}</span>
							<span class="text-xs font-normal text-white/50">{entry.description}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

{#snippet installForm()}
	<form onsubmit={review} class="flex flex-col gap-3">
		<h3 class="text-sm font-medium text-white/70">{m.apps_install_heading()}</h3>
		<div class="flex flex-col gap-1 text-sm text-white/60">
			{m.apps_image_label()}
			<TextField
				bind:value={image}
				label={m.apps_image_label()}
				placeholder={m.apps_image_placeholder()}
				enterkeyhint="next"
				mono
				class="rounded-2xl bg-white/12 px-4 py-3 text-sm ring-1 ring-white/25"
				onEnter={nextAfterImage}
			/>
		</div>
		{@render toggle(m.apps_verify_signature(), verifySignature, (on) => (verifySignature = on))}
		{#if verifySignature}
			<div class="flex flex-col gap-1 text-sm text-white/60">
				{m.apps_key_label()}
				<TextField
					bind:this={keyField}
					bind:value={publicKey}
					label={m.apps_key_label()}
					placeholder="-----BEGIN PUBLIC KEY-----"
					multiline
					mono
					class="rounded-2xl bg-white/12 px-4 py-3 text-xs ring-1 ring-white/25"
				/>
			</div>
		{/if}
		<button
			type="submit"
			disabled={!image.trim() || (verifySignature && !publicKey.trim()) || apps.busy !== null}
			class="bg-white/12 text-white/85 ring-1 ring-white/25 hover:bg-white/20 {buttonBase}"
		>
			{m.apps_review()}
		</button>
	</form>
{/snippet}

{#snippet pendingUpdate(app: InstalledApp, update: NonNullable<InstalledApp['update']>)}
	<div
		class="rounded-2xl bg-indigo-500/15 p-3 ring-1 ring-indigo-400/30"
		in:scale={{ start: 0.96, duration: 250, easing: quintOut }}
	>
		<p class="text-sm text-indigo-100">{m.apps_update_available({ version: update.version })}</p>
		{#if update.addedPermissions.length > 0 || update.addedDomains.length > 0}
			<p class="mt-2 text-sm text-white/60">{m.apps_update_adds()}</p>
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
				onclick={() => actions.approveUpdate(app.id)}
				class="flex-1 bg-indigo-500 text-white {buttonBase}"
			>
				{m.apps_approve()}
			</button>
			<button
				type="button"
				onclick={() => actions.rejectUpdate(app.id)}
				class="bg-white/12 text-white/80 {buttonBase}"
			>
				{m.apps_reject()}
			</button>
		</div>
	</div>
{/snippet}

{#snippet installed(app: InstalledApp)}
	{@const expanded = expandedAppId === app.id}
	<li
		class="flex flex-col rounded-3xl bg-white/10 ring-1 ring-white/15"
		in:fly|global={{ y: 16, duration: 300, easing: quintOut }}
		out:fade|global={{ duration: 150 }}
	>
		<button
			type="button"
			aria-expanded={expanded}
			onclick={() => (expandedAppId = expanded ? null : app.id)}
			class="flex w-full items-center gap-3 p-4 text-left focus:outline-none {expanded
				? 'rounded-t-3xl'
				: 'rounded-3xl'}"
		>
			{@render appBadge(app.id, app.name, app.icon, app.primaryColor, app.secondaryColor)}
			<span class="min-w-0 flex-1">
				<span class="flex items-baseline gap-2">
					<span class="truncate text-lg font-semibold text-white/90">{app.name}</span>
					<span class="shrink-0 text-xs text-white/40">{app.version}</span>
				</span>
				{#if !expanded && (app.update || app.error)}
					<span class="block truncate text-xs {app.error ? 'text-red-300' : 'text-indigo-200'}">
						{app.error ?? m.apps_update_available({ version: app.update?.version ?? '' })}
					</span>
				{/if}
			</span>
			<ChevronDown
				class="size-5 shrink-0 text-white/50 transition-transform duration-200 {expanded
					? 'rotate-180'
					: ''}"
			/>
		</button>

		{#if expanded}
			<div class="flex flex-col gap-1 px-4 pb-4" transition:slide={{ duration: 200 }}>
				<p class="font-mono text-xs break-all text-white/40">{app.image}</p>

				{@render toggle(m.apps_enabled(), app.enabled, (on) => actions.setEnabled(app.id, on))}
				{@render toggle(m.apps_auto_update(), app.autoUpdate, (on) =>
					actions.setAutoUpdate(app.id, on)
				)}

				{#if app.permissions.length > 0}
					<h4 class="mt-1 text-sm font-medium text-white/70">{m.apps_permissions()}</h4>
					{#each app.permissions as permission (permission.key)}
						{@render toggle(
							permissionLabel(permission.key),
							permission.granted,
							(on) => actions.setPermission(app.id, permission.key, on),
							permissionHint(permission.key)
						)}
						{#if permission.key === 'network'}{@render domainList(app.domains)}{/if}
					{/each}
				{/if}

				{#if app.update}{@render pendingUpdate(app, app.update)}{/if}
				{#if app.error}
					<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200">{app.error}</p>
				{/if}

				<div class="mt-2 flex flex-wrap items-center gap-3">
					{#if appHasClearCache(app)}
						<HoldToConfirmButton
							label={m.apps_clear_cache()}
							icon={Recycle}
							variant="neutral"
							onConfirm={() => actions.clearCache(app.id)}
						/>
					{/if}
					{#if appHasClearStorage(app)}
						<HoldToConfirmButton
							label={m.apps_clear_storage()}
							icon={Eraser}
							variant="warning"
							onConfirm={() => actions.clearStorage(app.id)}
						/>
					{/if}
					<HoldToConfirmButton
						label={m.apps_uninstall()}
						icon={Trash2}
						variant="danger"
						onConfirm={() => actions.uninstall(app.id)}
					/>
				</div>
			</div>
		{/if}
	</li>
{/snippet}

<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
	<div class="flex min-w-0 flex-col gap-5 lg:w-xl lg:shrink-0">
		{#if busyLabel}
			<p class="flex items-center gap-2 text-sm text-white/60" transition:fade={{ duration: 150 }}>
				<LoaderCircle class="size-4 animate-spin" />
				{busyLabel}
			</p>
		{/if}
		{#if apps.error}
			<p
				class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30"
				transition:fly={{ y: -8, duration: 250, easing: quintOut }}
			>
				{apps.error}
			</p>
		{/if}

		{#key apps.preview ? 'preview' : 'form'}
			<div
				in:fly={{ y: 12, duration: 250, delay: 120, easing: quintOut }}
				out:fade={{ duration: 120 }}
			>
				{#if apps.preview}
					{@render preview(apps.preview)}
				{:else}
					{@render installForm()}
				{/if}
			</div>
		{/key}
	</div>

	<div class="flex min-w-0 flex-1 flex-col gap-3">
		{#if apps.apps.length === 0}
			<p class="text-center text-sm text-white/40" transition:fade={{ duration: 200 }}>
				{m.apps_none()}
			</p>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each apps.apps as app (app.id)}
					{@render installed(app)}
				{/each}
			</ul>
			<button
				type="button"
				disabled={apps.busy !== null}
				onclick={actions.checkUpdates}
				class="mt-2 flex items-center justify-center gap-2 bg-white/12 text-white/85 ring-1 ring-white/25 hover:bg-white/20 {buttonBase}"
			>
				<RefreshCw class="size-4" />
				{m.apps_check_updates()}
			</button>
			{#if checkSummaryText}
				<p class="text-center text-xs text-white/50" transition:fade={{ duration: 150 }}>
					{checkSummaryText}
				</p>
			{/if}
		{/if}
	</div>

	{#if visibleSuggested.length > 0}
		<div class="lg:w-72 lg:shrink-0">
			{@render suggestedList()}
		</div>
	{/if}
</div>
