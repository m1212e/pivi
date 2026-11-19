import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';

// Boards whose GPU can't keep up with blurred glass and animated backdrops at
// 1080p. The Pi 3's VideoCore IV dropped the home screen to ~10fps.
const WEAK_MODELS = /Raspberry Pi (3|Zero 2)/;

function detect(): boolean {
	const override = process.env.PIVI_LOW_POWER;
	if (override) return override === '1' || override === 'true';
	try {
		const model = readFileSync('/proc/device-tree/model', 'utf8');
		if (WEAK_MODELS.test(model)) return true;
	} catch {
		// Not a device-tree board, fall through to the memory heuristic.
	}
	return totalmem() < 1.5 * 1024 ** 3;
}

/** Whether the TV pages should render without blur and ambient animation. Set `PIVI_LOW_POWER=0|1` to override. */
export const lowPower = detect();
