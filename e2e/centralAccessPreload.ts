const realFetch = globalThis.fetch;

globalThis.fetch = Object.assign(
	async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input);
		if (url === "https://oauth.account.jetbrains.com/oauth2/token") {
			const form = new URLSearchParams(String(init?.body));
			if (form.get("refresh_token") !== "e2e-central-refresh") {
				throw new Error("Central fixture requires synthetic credentials");
			}
			return Response.json({ access_token: "e2e-central-access" });
		}
		if (url === "https://api.jetbrains.cloud/user-management/api/ai-access-options") {
			if (new Headers(init?.headers).get("Authorization") !== "Bearer e2e-central-access") {
				throw new Error("Central fixture requires synthetic credentials");
			}
			return Response.json({
				aiAccessOptions: [
					{
						type: "workspace",
						orgId: "aaa",
						workspaceId: "bbb",
						workspaceName: "JB Alumni",
						aiAccessEnabled: true,
					},
					{
						type: "workspace",
						orgId: "ccc",
						workspaceId: "ddd",
						workspaceName: "JetBrains Team",
						aiAccessEnabled: true,
					},
				],
			});
		}
		return realFetch(input, init);
	},
	{ preconnect: realFetch.preconnect },
);
