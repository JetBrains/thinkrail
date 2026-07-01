// Registers the built-in pi tool renderers. Imported for its side effect by ChatView (the app-integration
// layer), so registration happens once when the chat module mounts. Idempotent: re-import is a no-op.
import { registerToolRenderer } from "../toolRegistry";
import { BashCard } from "./BashCard";
import { EditCard } from "./EditCard";
import { ReadCard } from "./ReadCard";
import { fileName, strArg } from "./toolHelpers";
import "./web/register";
import { WriteCard } from "./WriteCard";

// Each summary feeds the collapsed-by-default card header: a bash command, or the file name acted on.
registerToolRenderer("bash", BashCard, ({ args }) => strArg(args, "command"));
registerToolRenderer("read", ReadCard, ({ args }) => fileName(strArg(args, "path")));
registerToolRenderer("edit", EditCard, ({ args }) => fileName(strArg(args, "path")));
registerToolRenderer("write", WriteCard, ({ args }) => fileName(strArg(args, "path")));
