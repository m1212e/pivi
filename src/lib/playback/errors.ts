// Readable error text for the engine's fallback reason, which ends up in the
// diagnostics panel and the console.

// A shaka.util.Error, duck typed so this file stays free of the library.
function isShakaError(err: unknown): err is { category: unknown; code: unknown; message: unknown } {
	if (!err || typeof err !== 'object') return false;
	return ['category', 'code', 'message'].every((key) => key in err);
}

// A failed <video> fires a bare Event, the useful detail sits on the target's MediaError.
function describeEvent(event: Event): string {
	const target = event.target as { error?: { code: number; message: string } | null } | null;
	if (target?.error) {
		return `MediaError ${target.error.code}: ${target.error.message || '(no message)'}`;
	}
	return `${event.type} event on ${target?.constructor?.name ?? 'unknown target'}`;
}

/**
 * One readable line for anything a playback path can throw or emit. Use it
 * when recording a fallback reason, since Shaka, DOM and media errors all
 * stringify badly on their own.
 */
export function describeError(err: unknown): string {
	if (isShakaError(err)) {
		return `Shaka error (category ${err.category}, code ${err.code}): ${err.message}`;
	}
	if (err instanceof DOMException) return `${err.name}: ${err.message}`;
	if (err instanceof Error) return err.message;
	if (err instanceof Event) return describeEvent(err);
	return String(err);
}
