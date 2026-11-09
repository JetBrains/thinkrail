import { createSandboxExtension } from "./src/extension";

export { createSandboxExtension, type SandboxExtensionOptions } from "./src/extension";
export { canRead, canWrite, defaultSandboxPolicy, type SandboxPolicy } from "./src/policy";
export { createSandboxedBashOperations, type SandboxSupport, sandboxSupport } from "./src/runtime";
export default createSandboxExtension();
