// The last searches, kept per profile in the storage volume.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = '/storage/recent-searches.json';
const LIMIT = 10;

let recent: string[] = [];

export async function loadRecentSearches() {
	try {
		const parsed: unknown = JSON.parse(await readFile(FILE, 'utf8'));
		recent = Array.isArray(parsed)
			? parsed.filter((q): q is string => typeof q === 'string').slice(0, LIMIT)
			: [];
	} catch {
		recent = [];
	}
}

export function recentSearches(): string[] {
	return recent;
}

export async function rememberSearch(query: string) {
	recent = [query, ...recent.filter((q) => q.toLowerCase() !== query.toLowerCase())].slice(
		0,
		LIMIT
	);
	try {
		await writeFile(FILE, JSON.stringify(recent));
	} catch {
		// History is a convenience, a read-only volume just loses it.
	}
}
