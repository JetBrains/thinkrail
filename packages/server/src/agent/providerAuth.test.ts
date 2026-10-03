import { expect, test } from "bun:test";
import { catalogProviderAuth, describeProviderAuth } from "./providerAuth";

test("describeProviderAuth ranks Central over OAuth over credential source", () => {
	expect(describeProviderAuth({ central: true, oauth: true, source: "environment" })).toEqual({
		kind: "central",
	});
	expect(describeProviderAuth({ central: false, oauth: true, source: "stored" })).toEqual({
		kind: "oauth",
	});
	expect(
		describeProviderAuth({ central: false, oauth: false, source: "environment", label: "X_KEY" }),
	).toEqual({ kind: "env", detail: "X_KEY" });
	expect(describeProviderAuth({ central: false, oauth: false, source: "stored" })).toEqual({
		kind: "api-key",
	});
	expect(describeProviderAuth({ central: false, oauth: false, source: "models_json_key" })).toEqual(
		{ kind: "api-key", detail: "models.json" },
	);
	expect(describeProviderAuth({ central: false, oauth: false, source: "fallback" })).toEqual({
		kind: "other",
	});
	expect(
		describeProviderAuth({
			central: false,
			oauth: false,
			apiKeyCredential: true,
			source: "fallback",
		}),
	).toEqual({ kind: "api-key" });
	expect(describeProviderAuth({ central: false, oauth: false })).toEqual({ kind: "other" });
});

test("catalogProviderAuth reads pi's synchronous auth facts for a provider", () => {
	const generation = {
		opaqueProviderIds: new Set(["central-proxy"]),
		runtime: {
			isUsingOAuth: (id: string) => id === "anthropic",
			getProviderAuthStatus: (id: string) =>
				id === "google"
					? { configured: true, source: "environment" as const, label: "GEMINI_API_KEY" }
					: { configured: true, source: "stored" as const },
		},
	} as unknown as Parameters<typeof catalogProviderAuth>[0];
	expect(catalogProviderAuth(generation, "anthropic")).toEqual({ kind: "oauth" });
	expect(catalogProviderAuth(generation, "google")).toEqual({
		kind: "env",
		detail: "GEMINI_API_KEY",
	});
	expect(catalogProviderAuth(generation, "central-proxy")).toEqual({ kind: "central" });
	expect(catalogProviderAuth(generation, "openai")).toEqual({ kind: "api-key" });
});
