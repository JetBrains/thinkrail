import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

export default function Disabled() {
	const t = useT();
	const [scope, setScope] = useState<"user" | "project">("user");
	const projectScopeAvailable = false;
	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-wrap items-center gap-2">
				<ToggleSegment
					testid="mcp-add-scope-user"
					label={t("mcp.addDialog.scopeUser")}
					active={scope === "user"}
					onClick={() => setScope("user")}
				/>
				<ToggleSegment
					testid="mcp-add-scope-project"
					label={t("mcp.addDialog.scopeProject")}
					active={scope === "project"}
					disabled={!projectScopeAvailable}
					onClick={() => setScope("project")}
				/>
			</div>
			<p className="tr-text-metadata text-text-muted">{t("mcp.addDialog.untrusted")}</p>
		</div>
	);
}
