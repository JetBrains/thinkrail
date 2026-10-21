import type { Workspace } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { isExternalWorkspace } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";
import { removeWorkspace } from "./workspaceActions";

export function RemoveWorkspaceDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: Workspace;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const isExternal = isExternalWorkspace(workspace);
	const branch = <span key="branch" className="tr-text-emphasis text-text-default" />;
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={
				isExternal
					? t("panels.removeWorkspace.titleExternal", { name: workspace.name })
					: t("panels.removeWorkspace.title", { name: workspace.name })
			}
			description={
				<T
					i18nKey={
						isExternal
							? "panels.removeWorkspace.descriptionExternal"
							: "panels.removeWorkspace.description"
					}
					values={{ branch: workspace.branch }}
					components={[branch]}
				/>
			}
			confirmLabel={isExternal ? t("panels.removeWorkspace.confirmExternal") : t("common.remove")}
			destructive
			confirmTestId="confirm-remove"
			onConfirm={() => removeWorkspace(workspace.id)}
		/>
	);
}
