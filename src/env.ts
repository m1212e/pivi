import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'The database connection string.' },
	QR_BIND_IP: {
		description: 'The ip address to be for pairing',
		schema: (value) => value || null
	},
	QR_BIND_HOSTNAME: {
		description: 'The Hostname to be for pairing',
		schema: (value) => value || null
	},
	PIVI_CONFIG: {
		description:
			'Path of the configuration file (see pivi.toml). Defaults to pivi.toml in the working directory.',
		schema: (value) => value || null
	},
	ORIGIN: {
		description:
			'The app origin (base URL), e.g. `http://localhost:5173`. Leave unset to derive it from each request (the TV and the phone reach the server on different hosts). Must not be set to an empty string: adapter-node rejects that.',
		schema: (value) => value || null
	}
});
