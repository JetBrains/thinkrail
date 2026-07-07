// Registers the web-tools renderers, joined to the bundled `pi-web-access` extension by tool name.
// Imported for its side effect by `tools/register` (which `ChatView` imports once on mount).
import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { WebFetchCard } from "./WebFetchCard";
import { WebSearchCard } from "./WebSearchCard";

// Both ROUTINE (the default — they fold into activity groups). Step-row/header summaries: the search
// query, and the fetched URL.
registerToolRenderer("web_search", WebSearchCard, { summary: ({ args }) => strArg(args, "query") });
registerToolRenderer("fetch_content", WebFetchCard, { summary: ({ args }) => strArg(args, "url") });
