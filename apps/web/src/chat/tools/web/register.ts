// Registers the web-tools renderers, joined to the bundled `pi-web-access` extension by tool name.
// Imported for its side effect by `tools/register` (which `ChatView` imports once on mount).
import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { WebFetchCard } from "./WebFetchCard";
import { WebSearchCard } from "./WebSearchCard";

// Collapsed-card header summaries: the search query, and the fetched URL.
registerToolRenderer("web_search", WebSearchCard, ({ args }) => strArg(args, "query"));
registerToolRenderer("fetch_content", WebFetchCard, ({ args }) => strArg(args, "url"));
