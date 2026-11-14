import { checkProject } from '../staticChecks';

export function validate(
	dir: string,
	options: { entry?: string; strict?: boolean; json?: boolean }
) {
	const findings = checkProject(dir, options.entry);
	const errors = findings.filter((f) => f.level === 'error');
	const warnings = findings.filter((f) => f.level === 'warning');
	if (options.json) {
		console.log(
			JSON.stringify(
				{ ok: errors.length === 0 && !(options.strict && warnings.length), findings },
				null,
				2
			)
		);
	} else {
		for (const f of findings) console.log(`${f.level === 'error' ? '✗' : '!'} ${f.message}`);
		if (findings.length === 0) console.log('✓ the app looks valid');
		else console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
	}
	return errors.length > 0 || (options.strict && warnings.length > 0) ? 1 : 0;
}
