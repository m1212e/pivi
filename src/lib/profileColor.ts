const PALETTE = [
	['#f472b6', '#ec4899'], // pink
	['#60a5fa', '#3b82f6'], // blue
	['#4ade80', '#22c55e'], // green
	['#fb923c', '#f97316'], // orange
	['#c084fc', '#a855f7'], // purple
	['#38bdf8', '#0ea5e9'], // sky
	['#facc15', '#eab308'], // yellow
	['#fb7185', '#f43f5e'] // rose
] as const;

export function profileGradient(seed: string) {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	const [from, to] = PALETTE[hash % PALETTE.length];
	return `linear-gradient(135deg, ${from}, ${to})`;
}
