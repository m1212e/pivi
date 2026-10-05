// This app's end of the host protocol: JSON-RPC over stdin/stdout, one JSON
// message per line (see #lib/apps/ndjson). stdout is the channel itself, so
// createStdioConnection also reroutes console.log to stderr — the log stream the
// host captures — before anything else can write to it.
import { createStdioConnection } from '#lib/apps/stdioConnection';

export const connection = createStdioConnection();
