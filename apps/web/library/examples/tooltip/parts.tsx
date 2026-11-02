import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@thinkrail/ui/tooltip";

export default function Parts() {
	const t = useT();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="outline" size="m">
					{t("review.panel.clear")}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom" align="start">
				{t("review.panel.clearTooltip")}
			</TooltipContent>
		</Tooltip>
	);
}
