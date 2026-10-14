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
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.'
	}
});
