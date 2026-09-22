import { building, dev } from '$app/env';
import { startDeviceCleanupSchedule } from '../deviceCleanup';
import { clientCreator } from '../rumble';
import { startPairingRelay } from '../ws/relay';
import './user';
import './pairing';
import './auth';
import './youtube';
import './remote';

if (!building) {
	startPairingRelay();
	startDeviceCleanupSchedule();
}

if (dev || building) {
	await clientCreator({
		outputPath: 'src/lib/api/rumbleClient',
		apiUrl: '/api/graphql',
		useExternalUrqlClient: '../client',
		removeExisting: false,
		autoIncludeIdField: false
	});
}
