import { registerToolRenderer } from "../../toolRegistry";
import { WebFetchCard, webFetchSummary } from "./WebFetchCard";
import { WebSearchCard, webSearchSummary } from "./WebSearchCard";
import { storedContentSummary, WebStoredContentCard } from "./WebStoredContentCard";

registerToolRenderer("web_search", WebSearchCard, { summary: webSearchSummary });
registerToolRenderer("fetch_content", WebFetchCard, { summary: webFetchSummary });
registerToolRenderer("get_search_content", WebStoredContentCard, {
	summary: storedContentSummary,
});
