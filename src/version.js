// Shared by the client, sandboxed parser, planner, and controlled-server tooling.
// Pure constants: this module is explicitly allowed into the parser sandbox.
export const MINECRAFT = Object.freeze({
  version: '1.21.11',
  protocolVersion: 774,
  dataVersion: 4671,
  litematicVersion: 7,
  litematicSubVersion: 1
});
export const TEST_SERVER_DIRECTORY = `runtime/test-server-${MINECRAFT.version}`;
