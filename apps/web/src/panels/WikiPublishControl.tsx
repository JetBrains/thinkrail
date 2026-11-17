import type { WikiStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { publishRepoWiki } from "./wikiActions";

export function WikiPublishControl({
	workspaceId,
	status,
	onPublished,
}: {
	workspaceId: string;
	status: WikiStatus;
	onPublished: () => void;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const target = status.publishTarget;

	const publish = () => {
		setPublishing(true);
		void publishRepoWiki(workspaceId)
			.then((published) => {
				if (published) onPublished();
			})
			.finally(() => setPublishing(false));
	};

	return (
		<>
			<Button
				variant="outline"
				data-testid="wiki-publish"
				disabled={!status.built || target === null || publishing}
				loading={publishing}
				tooltip={
					target === null
						? t("panels.wiki.publish.notGithub")
						: !status.built
							? t("panels.wiki.publish.needsBuild")
							: undefined
				}
				onClick={() => setConfirming(true)}
			>
				{status.publication ? t("panels.wiki.publish.sync") : t("panels.wiki.publish.action")}
			</Button>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("panels.wiki.publish.confirmTitle")}
				description={t("panels.wiki.publish.confirmDescription", { repo: target ?? "" })}
				confirmLabel={t("panels.wiki.publish.confirm")}
				confirmTestId="wiki-publish-confirm"
				onConfirm={publish}
			/>
		</>
	);
}
