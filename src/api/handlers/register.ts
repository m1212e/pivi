import { building, dev } from '$app/env';
import { startDeviceCleanupSchedule } from '../deviceCleanup';
import { clientCreator } from '../rumble';
import { startWifiProvisioning } from '../wifiCommands';
import { startPairingRelay } from '../ws/relay';
import './user';
import './pairing';
import './auth';
import './youtube';
import './remote';
import './playback';
import './network';

if (!building) {
	startPairingRelay();
	startDeviceCleanupSchedule();
	// Async, and deliberately not awaited: it talks to NetworkManager, and the
	// first request through here shouldn't wait on a scan of the local radio.
	// Nothing downstream depends on it having finished -- the phone's own wifi
	// screen asks for state when it opens.
	void startWifiProvisioning();
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
