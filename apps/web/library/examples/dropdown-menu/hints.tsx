import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useState } from "react";

const EXPOSURES = {
	direct: { label: "mcp.exposure.direct", hint: "mcp.exposure.directHint" },
	deferred: { label: "mcp.exposure.deferred", hint: "mcp.exposure.deferredHint" },
	hidden: { label: "mcp.exposure.hidden", hint: "mcp.exposure.hiddenHint" },
} as const;
type Exposure = keyof typeof EXPOSURES;
const isExposure = (value: string): value is Exposure => value in EXPOSURES;

export default function Hints() {
	const t = useT();
	const [exposure, setExposure] = useState<Exposure>("deferred");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="s"
					iconRight={RiArrowDownSLine}
					aria-label={t("mcp.exposure.menuAria", { exposure })}
				>
					{t(EXPOSURES[exposure].label)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-[20rem]">
				<DropdownMenuLabel>{t("mcp.exposure.menuTitle")}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={exposure}
					onValueChange={(value) => {
						if (isExposure(value)) setExposure(value);
					}}
				>
					{(Object.keys(EXPOSURES) as Exposure[]).map((id) => (
						<DropdownMenuRadioItem key={id} value={id} className="items-start">
							{id === exposure ? (
								<RiCheckLine className="mt-2" />
							) : (
								<span aria-hidden className="size-14 shrink-0" />
							)}
							<span className="flex flex-col gap-2">
								<span>{t(EXPOSURES[id].label)}</span>
								<span className="tr-text-metadata text-text-muted">{t(EXPOSURES[id].hint)}</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
