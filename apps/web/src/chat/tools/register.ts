// Registers the built-in pi tool renderers. Imported for its side effect by ChatView (the app-integration
// layer), so registration happens once when the chat module mounts. Idempotent: re-import is a no-op.
import { registerToolRenderer } from "../toolRegistry";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { BashCard } from "./BashCard";
import { EditCard } from "./EditCard";
import { ReadCard } from "./ReadCard";
import { projectRelativePath, strArg } from "./toolHelpers";
import "./visualize/register";
import "./web/register";
import { WriteCard } from "./WriteCard";

// The core pi tools are ROUTINE (the default): they fold into activity groups. Each summary feeds the
// fold's step rows (and the collapsed card header): a bash command, or the file path acted on.
registerToolRenderer("bash", BashCard, { summary: ({ args }) => strArg(args, "command") });
registerToolRenderer("read", ReadCard, {
	summary: ({ args, workspaceRoot }) => projectRelativePath(strArg(args, "path"), workspaceRoot),
});
registerToolRenderer("edit", EditCard, {
	summary: ({ args, workspaceRoot }) => projectRelativePath(strArg(args, "path"), workspaceRoot),
});
registerToolRenderer("write", WriteCard, {
	summary: ({ args, workspaceRoot }) => projectRelativePath(strArg(args, "path"), workspaceRoot),
});

// The inline clarifying-questions questionnaire (host-owned `ask_user_question` tool). Registered with
// `"bare"` chrome so it renders as a full-width, always-open panel (interactive — and primary by
// construction: bare implies it, so it never folds into an activity group).
registerToolRenderer("ask_user_question", AskUserQuestionCard, { chrome: "bare" });
