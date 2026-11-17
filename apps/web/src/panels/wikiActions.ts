import { t } from "@thinkrail/locales/react";
import { toast } from "@/store";
import { errorText, getTransport, wsErrorCode } from "@/transport";
import { startChatInTab } from "./openChat";
import { useWikiPageState } from "./wikiPageState";

const openChatWithPrompt = (workspaceId: string, prompt: string) =>
	startChatInTab(workspaceId, { prompt });

export async function startWikiBuild(
	workspaceId: string,
	model: { provider: string; id: string },
	codeOnly: boolean,
	openChat: (workspaceId: string, prompt: string) => Promise<void> = openChatWithPrompt,
): Promise<void> {
	try {
		const plan = await getTransport().request("wiki.prepareBuild", {
			workspaceId,
			model: `${model.provider}/${model.id}`,
			codeOnly,
		});
		useWikiPageState.getState().close();
		await openChat(workspaceId, plan.prompt);
		toast.info(t("panels.wiki.build.started"));
	} catch (err) {
		toast.error(errorText(err), t("panels.wiki.build.failed"));
	}
}

export async function publishRepoWiki(workspaceId: string): Promise<boolean> {
	try {
		const result = await getTransport().request("wiki.publish", { workspaceId });
		toast.success(result.url, t("panels.wiki.publish.done", { count: result.pageCount }));
		return true;
	} catch (err) {
		const code = wsErrorCode(err);
		const message =
			code === "WIKI_BRANCH_FOREIGN"
				? t("panels.wiki.publish.foreignBranch", { detail: errorText(err) })
				: code === "WIKI_NOT_GITHUB"
					? t("panels.wiki.publish.notGithub")
					: errorText(err);
		toast.error(message, t("panels.wiki.publish.failed"));
		return false;
	}
}
