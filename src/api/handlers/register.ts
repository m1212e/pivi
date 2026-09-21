import { building, dev } from '$app/env';
import { clientCreator } from '../rumble';
import './user';
import './pairing';
import './auth';

if (dev || building) {
	await clientCreator({
		outputPath: 'src/lib/api/rumbleClient',
		apiUrl: '/api/graphql',
		useExternalUrqlClient: '../client',
		removeExisting: false,
		autoIncludeIdField: false
	});
}
