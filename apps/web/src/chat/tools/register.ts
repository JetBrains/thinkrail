import { projectRelativePath } from "@/lib";
import { registerToolRenderer } from "../toolRegistry";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { BashCard } from "./BashCard";
import { EditCard } from "./EditCard";
import { ReadCard } from "./ReadCard";
import { ResolveCommentCard } from "./ResolveCommentCard";
import { SpecToolCard, specToolSummary } from "./SpecToolCard";
import { strArg } from "./toolHelpers";
import "./subagent/register";
import "./visualize/register";
import "./web/register";
import { WriteCard } from "./WriteCard";

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

for (const toolName of [
	"spec_grep",
	"spec_get",
	"spec_graph",
	"spec_create",
	"spec_update",
	"spec_delete",
	"spec_validate",
]) {
	registerToolRenderer(toolName, SpecToolCard, { summary: specToolSummary });
}

registerToolRenderer("resolve_comment", ResolveCommentCard, {
	summary: ({ args }) => strArg(args, "commentId"),
});

registerToolRenderer("ask_user_question", AskUserQuestionCard, { chrome: "bare" });
