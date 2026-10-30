import { useT } from "@thinkrail/locales/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";

export default function Status() {
	const t = useT();
	return (
		<div className="flex items-center gap-8">
			<span>filesystem</span>
			<IconTooltip label={t("mcp.server.stdioTooltip")} wrapTrigger>
				<span>
					{t("mcp.transport.stdio")}
					<span className="sr-only">{` ${t("mcp.server.stdioSrOnly")}`}</span>
				</span>
			</IconTooltip>
		</div>
	);
}
