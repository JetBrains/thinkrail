import type { InlineExtension, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { BackgroundCommandsOptions } from "pi-background-commands";
import {
	createSandboxExtension,
	createSandboxedBashOperations,
	defaultSandboxPolicy,
	type SandboxExtensionOptions,
} from "pi-sandbox";

export function sandboxEnabled(): boolean {
	return process.env.THINKRAIL_SANDBOX === "1";
}

function shellSettings(
	settingsManager: SettingsManager,
): ReturnType<NonNullable<SandboxExtensionOptions["shell"]>> {
	const shell: { shellPath?: string; commandPrefix?: string } = {};
	const shellPath = settingsManager.getShellPath();
	const commandPrefix = settingsManager.getShellCommandPrefix();
	if (shellPath) shell.shellPath = shellPath;
	if (commandPrefix) shell.commandPrefix = commandPrefix;
	return shell;
}

export function sandboxExtensions(settingsManager?: SettingsManager): InlineExtension[] {
	if (!sandboxEnabled()) return [];
	const options: SandboxExtensionOptions = {};
	if (settingsManager) options.shell = () => shellSettings(settingsManager);
	return [createSandboxExtension(options)];
}

export function sandboxCommandOptions(): BackgroundCommandsOptions {
	if (!sandboxEnabled()) return {};
	return {
		createOperations: (options) => createSandboxedBashOperations(defaultSandboxPolicy, options),
	};
}
