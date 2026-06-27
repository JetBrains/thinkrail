// Registers the built-in pi tool renderers. Imported for its side effect by ChatView (the app-integration
// layer), so registration happens once when the chat module mounts. Idempotent: re-import is a no-op.
import { registerToolRenderer } from "../toolRegistry";
import { BashCard } from "./BashCard";
import { EditCard } from "./EditCard";
import { ReadCard } from "./ReadCard";
import { WriteCard } from "./WriteCard";

registerToolRenderer("bash", BashCard);
registerToolRenderer("read", ReadCard);
registerToolRenderer("edit", EditCard);
registerToolRenderer("write", WriteCard);
