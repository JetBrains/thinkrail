import { createBackgroundCommandsExtension } from "./src/extension";

export {
	BACKGROUND_COMMAND_COMPLETION_MESSAGE,
	type BackgroundCommandInput,
	type BackgroundCommandsExtensionOptions,
	createBackgroundCommandsExtension,
} from "./src/extension";
export { createBackgroundCommands } from "./src/service";
export default createBackgroundCommandsExtension();
export type {
	BackgroundCommandCompletion,
	BackgroundCommandCompletionBinding,
	BackgroundCommandContext,
	BackgroundCommandHandle,
	BackgroundCommandOutput,
	BackgroundCommandSnapshot,
	BackgroundCommandStart,
	BackgroundCommandStatus,
	BackgroundCommands,
	BackgroundCommandsBinding,
	BackgroundCommandsOptions,
} from "./src/types";
