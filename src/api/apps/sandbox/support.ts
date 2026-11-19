import { access, constants } from 'node:fs/promises';

/** Why apps can't run here: no KVM at all (a Pi 3), KVM the server may not open, or no microVM runtime. */
export type SandboxProblem = 'no-kvm' | 'kvm-denied' | 'no-runtime';

async function check(): Promise<SandboxProblem | null> {
	try {
		await access('/dev/kvm', constants.R_OK | constants.W_OK);
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no-kvm' : 'kvm-denied';
	}
	try {
		const msb = await import('microsandbox');
		return msb.isRuntimeInstalled({ home: process.env.PIVI_SANDBOX_HOME }) ? null : 'no-runtime';
	} catch {
		// The native addon doesn't load on this platform.
		return 'no-runtime';
	}
}

let result: Promise<SandboxProblem | null> | undefined;

/** Null when apps can run on this machine. Checked once, none of it changes without a reboot. */
export function sandboxProblem(): Promise<SandboxProblem | null> {
	result ??= check();
	return result;
}
