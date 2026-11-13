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
	PIVI_SUGGESTED_APPS: {
		description:
			'App images offered for one-tap install, separated by spaces or commas. What each one is (name, icon, description) is read from its own manifest.',
		schema: (value) => value || null
	},
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.'
	}
});
