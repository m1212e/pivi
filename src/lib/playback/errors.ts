// Feeds the diagnostics panel and the fallback log.

// A shaka.util.Error, duck typed so this file stays free of the library.
function isShakaError(err: unknown): err is { category: unknown; code: unknown; message: unknown } {
	if (!err || typeof err !== 'object') return false;
	return ['category', 'code', 'message'].every((key) => key in err);
}

function describeEvent(event: Event): string {
	const target = event.target as { error?: { code: number; message: string } | null } | null;
	if (target?.error) {
		return `MediaError ${target.error.code}: ${target.error.message || '(no message)'}`;
	}
	return `${event.type} event on ${target?.constructor?.name ?? 'unknown target'}`;
}

export function describeError(err: unknown): string {
	if (isShakaError(err)) {
		return `Shaka error (category ${err.category}, code ${err.code}): ${err.message}`;
	}
	if (err instanceof DOMException) return `${err.name}: ${err.message}`;
	if (err instanceof Error) return err.message;
	if (err instanceof Event) return describeEvent(err);
	return String(err);
}
