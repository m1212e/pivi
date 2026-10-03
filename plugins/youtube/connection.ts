// This plugin's end of the host protocol: JSON-RPC over stdin/stdout, one JSON
// message per line (see #lib/plugins/ndjson). stdout is the channel itself, so
// createStdioConnection also reroutes console.log to stderr — the log stream the
// host captures — before anything else can write to it.
import { createStdioConnection } from '#lib/plugins/stdioConnection';

export const connection = createStdioConnection();
