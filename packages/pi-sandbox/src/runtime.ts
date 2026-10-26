import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { type BashOperations, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import type { SandboxPolicy } from "./policy";

export type SandboxSupport = { supported: true } | { supported: false; reason: string };

let ready: Promise<void> | undefined;

function runtimeConfig(policy: SandboxPolicy): SandboxRuntimeConfig {
	return {
		network: {
			allowedDomains: policy.allowedDomains,
			deniedDomains: [],
			allowLocalBinding: policy.allowLocalBinding,
			...(policy.systemTrust ? { allowMachLookup: ["com.apple.trustd.agent"] } : {}),
		},
		filesystem: {
			denyRead: policy.denyRead,
			allowRead: policy.allowRead,
			allowWrite: policy.allowWrite,
			denyWrite: policy.denyWrite,
		},
	};
}

export function sandboxSupport(): SandboxSupport {
	if (!SandboxManager.isSupportedPlatform())
		return { supported: false, reason: `Sandboxing is not supported on ${process.platform}` };
	const { errors } = SandboxManager.checkDependencies();
	if (errors.length > 0) return { supported: false, reason: errors.join("; ") };
	return { supported: true };
}

function ensureRuntime(policy: SandboxPolicy): Promise<void> {
	ready ??= SandboxManager.initialize(runtimeConfig(policy)).catch((error) => {
		ready = undefined;
		throw error;
	});
	return ready;
}

export function createSandboxedBashOperations(
	policyFor: (cwd: string) => SandboxPolicy,
	options: { shellPath?: string } = {},
): BashOperations {
	const local = createLocalBashOperations(options);
	return {
		async exec(command, cwd, execOptions) {
			const policy = policyFor(cwd);
			await ensureRuntime(policy);
			const wrapped = await SandboxManager.wrapWithSandbox(
				command,
				undefined,
				runtimeConfig(policy),
				execOptions.signal,
			);
			try {
				return await local.exec(wrapped, cwd, execOptions);
			} finally {
				SandboxManager.cleanupAfterCommand();
			}
		},
	};
}
