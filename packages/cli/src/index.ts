// The pieces behind the `pivi-app` commands, for tests and tools that drive an app directly.
export { executeCommand } from './commands';
export { Harness, type HarnessOptions, type Problem, type Reply } from './harness';
export { generateProject, normalizeOptions, writeProject, type InitOptions } from './generate';
export { probeStream, type ProbeLine } from './probe';
export { readManifest, type ManifestResult } from './project';
export { checkProject, type Finding } from './staticChecks';
export { renderDashboard, renderUiTree } from './uiTree';
