// Assembles the GraphQL schema and starts the server's background services.
// Imported once by api.ts, which makes this the server's startup entry point.
import { building, dev } from '$app/env';
import { startDeviceCleanupSchedule } from '../deviceCleanup';
import { clientCreator } from '../rumble';
import { startWifiProvisioning } from '../wifiBootstrap';
import { startAppHost } from '../apps/lifecycle';
import { startPairingRelay } from '../ws/relay';
// Each import registers its GraphQL fields on the schema builder as a side effect.
import './user';
import './pairing';
import './auth';
import './apps';
import './appManagement';
import './remote';
import './playback';
import './network';
import './wifi';
import './systemUpdate';

// Background work stays off during build, where the db is mocked and nothing
// should bind a port.
if (!building) {
	startPairingRelay();
	startDeviceCleanupSchedule();
	startAppHost();
	// Runs in the background so the first request doesn't wait on
	// NetworkManager. The /wifi screen asks for state itself.
	startWifiProvisioning();
}

// Keeps the typed client in step with the schema, only dev and build have the
// schema available to generate from.
if (dev || building) {
	await clientCreator({
		outputPath: 'src/lib/api/rumbleClient',
		apiUrl: '/api/graphql',
		useExternalUrqlClient: '../client',
		removeExisting: false,
		autoIncludeIdField: false
	});
}
