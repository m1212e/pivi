<!-- Matches HeroBanner's exact dimensions so the top bar (overlaid on top of
     whichever of the two is showing) doesn't jump once real data arrives. -->
<div class="relative h-[52vh] min-h-80 w-full overflow-hidden sm:h-[60vh]">
	<div class="absolute inset-0 mask-b-from-55% mask-b-to-100%">
		<div class="absolute inset-0 bg-slate-800"></div>
		<div class="absolute inset-0 animate-pulse bg-white/5"></div>
		<!-- Same fade as HeroBanner's own, so swapping to the real banner
		     doesn't visibly snap the fade in. -->
		<div
			class="absolute inset-0 bg-linear-to-t from-slate-950 via-slate-950/40 to-transparent"
		></div>
	</div>

	<div class="absolute inset-x-0 bottom-0 flex flex-col gap-4 px-8 pb-10 sm:px-12 sm:pb-14">
		<div class="h-4 w-24 animate-pulse rounded bg-white/10"></div>
		<div class="h-10 w-2/3 max-w-2xl animate-pulse rounded bg-white/10 sm:h-14"></div>
		<div class="h-4 w-1/2 max-w-xl animate-pulse rounded bg-white/10"></div>
		<div class="mt-2 flex gap-3">
			<div class="h-11 w-28 animate-pulse rounded-full bg-white/10"></div>
			<div class="h-11 w-32 animate-pulse rounded-full bg-white/10"></div>
		</div>
	</div>
</div>
