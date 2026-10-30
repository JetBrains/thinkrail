import type { Translator } from "@thinkrail/locales/react";
import { errorText, getTransport, wsErrorCode } from "../transport";

export type OpenProjectFailure = { kind: "initable" } | { kind: "notice"; text: string };

export async function explainOpenFailure(
	err: unknown,
	path: string,
	t: Translator,
): Promise<OpenProjectFailure> {
	const status =
		wsErrorCode(err) === "GIT_TIMEOUT"
			? null
			: await getTransport()
					.request("project.inspect", { path })
					.catch(() => null);
	if (status?.kind === "initable") return { kind: "initable" };
	if (status?.kind === "missing")
		return { kind: "notice", text: t("panels.openProject.missing", { path }) };
	if (status?.kind === "notDirectory")
		return { kind: "notice", text: t("panels.openProject.notDirectory", { path }) };
	return { kind: "notice", text: errorText(err, t("panels.openProject.openPathFailed", { path })) };
}
