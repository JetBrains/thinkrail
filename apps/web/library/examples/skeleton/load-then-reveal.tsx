import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useEffect, useRef, useState } from "react";

const WORKSPACES = ["main", "design-system-audit", "component-pages"];

export default function LoadThenReveal() {
	const [expanded, setExpanded] = useState(true);
	const [list, setList] = useState<string[] | undefined>(undefined);
	const timer = useRef(0);
	const load = () => {
		window.clearTimeout(timer.current);
		setList(undefined);
		timer.current = window.setTimeout(() => setList(WORKSPACES), 1500);
	};
	useEffect(() => {
		load();
		return () => window.clearTimeout(timer.current);
	}, []);
	return (
		<div className="flex min-h-112 w-full max-w-[20rem] flex-col">
			<Button
				variant="ghost"
				size="m"
				iconLeft={expanded ? RiArrowDownSLine : RiArrowRightSLine}
				aria-expanded={expanded}
				className="self-start"
				onClick={() => {
					if (!expanded) load();
					setExpanded(!expanded);
				}}
			>
				thinkrail
			</Button>
			{expanded && list === undefined && <LoadingRegion rows={2} className="py-4 pr-8 pl-16" />}
			{expanded && list !== undefined && (
				<ul className="mt-2 flex flex-col gap-2 py-4 pl-24 tr-text-ui text-text-default motion-safe:animate-reveal">
					{list.map((name) => (
						<li key={name}>{name}</li>
					))}
				</ul>
			)}
		</div>
	);
}
