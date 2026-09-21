<script lang="ts">
	let {
		title,
		description,
		badge,
		gradient,
		image
	}: {
		title: string;
		description: string;
		badge?: string;
		gradient?: string;
		image?: string;
	} = $props();
</script>

<div class="relative h-[52vh] min-h-80 w-full overflow-hidden sm:h-[60vh]">
	<div class="absolute inset-0 bg-slate-800" style:background={gradient}>
		{#if image}
			<img src={image} alt="" class="size-full object-cover object-top" />
		{/if}
	</div>

	<!-- Fades the artwork into the page background so the row below reads as
	     one continuous surface rather than a hard-edged banner. -->
	<div class="absolute inset-0 bg-linear-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
	<div
		class="absolute inset-0 bg-linear-to-r from-slate-950/80 via-slate-950/10 to-transparent"
	></div>

	<div class="absolute inset-x-0 bottom-0 flex flex-col gap-4 px-8 pb-10 sm:px-12 sm:pb-14">
		{#if badge}
			<span class="text-sm font-medium tracking-wide text-white/60 uppercase">{badge}</span>
		{/if}
		<h1 class="max-w-2xl text-3xl font-semibold text-white sm:text-5xl">{title}</h1>
		<p class="max-w-xl text-sm text-white/70 sm:text-base">{description}</p>

		<div class="mt-2 flex gap-3">
			<button
				type="button"
				class="flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-white/90 focus:outline-none sm:text-base"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" class="size-5">
					<path d="M8 5v14l11-7z" />
				</svg>
				Play
			</button>
			<button
				type="button"
				class="rounded-full bg-white/10 px-6 py-2.5 text-sm font-medium text-white/90 ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none sm:text-base"
			>
				More info
			</button>
		</div>
	</div>
</div>
