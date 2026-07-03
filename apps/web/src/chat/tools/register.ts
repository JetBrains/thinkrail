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

// Each summary feeds the collapsed-by-default card header: a bash command, or the file path acted on.
registerToolRenderer("bash", BashCard, ({ args }) => strArg(args, "command"));
registerToolRenderer("read", ReadCard, ({ args, workspaceRoot }) =>
	projectRelativePath(strArg(args, "path"), workspaceRoot),
);
registerToolRenderer("edit", EditCard, ({ args, workspaceRoot }) =>
	projectRelativePath(strArg(args, "path"), workspaceRoot),
);
registerToolRenderer("write", WriteCard, ({ args, workspaceRoot }) =>
	projectRelativePath(strArg(args, "path"), workspaceRoot),
);

// The inline clarifying-questions questionnaire (host-owned `ask_user_question` tool). Registered with
// `"bare"` chrome so it renders as a full-width, always-open panel (interactive, never folded).
registerToolRenderer("ask_user_question", AskUserQuestionCard, undefined, "bare");
