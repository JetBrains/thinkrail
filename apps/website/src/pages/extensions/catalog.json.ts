import type { APIRoute } from "astro";
import { loadExtensionCatalog } from "../../extensionCatalogSource";

export const GET: APIRoute = async () => {
	const { catalog } = await loadExtensionCatalog();
	return new Response(`${JSON.stringify(catalog, null, 2)}\n`, {
		headers: { "Content-Type": "application/json" },
	});
};
