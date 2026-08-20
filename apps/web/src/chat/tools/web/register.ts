import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { WebFetchCard } from "./WebFetchCard";
import { WebSearchCard } from "./WebSearchCard";

registerToolRenderer("web_search", WebSearchCard, { summary: ({ args }) => strArg(args, "query") });
registerToolRenderer("fetch_content", WebFetchCard, { summary: ({ args }) => strArg(args, "url") });
