import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useRef, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { TreeRow } from "@/panels/TreeRow";

const FILES = Array.from({ length: 40 }, (_, index) => `src/file-${index + 1}.ts`);

export default function RememberedScroll() {
	const t = useT();
	const [shown, setShown] = useState(true);
	const savedTop = useRef(0);
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!viewport) return;
		viewport.scrollTop = savedTop.current;
		const save = () => {
			savedTop.current = viewport.scrollTop;
		};
		viewport.addEventListener("scroll", save, { passive: true });
		return () => viewport.removeEventListener("scroll", save);
	}, [viewport]);
	return (
		<div className="flex w-full flex-col gap-8">
			<Button
				variant="outline"
				size="m"
				className="self-start"
				selected={shown}
				aria-pressed={shown}
				onClick={() => setShown((value) => !value)}
			>
				{t("workbench.tool.files")}
			</Button>
			<div className="h-160 w-full max-w-[20rem] bg-container-sidebar-bg">
				{shown ? (
					<QuietScrollArea
						className="h-full"
						viewportClassName="p-panel-inset"
						viewportRef={setViewport}
					>
						<ul className="flex flex-col">
							{FILES.map((name) => (
								<li key={name}>
									<TreeRow testid="file-node" kind="file" label={name} onClick={() => {}} />
								</li>
							))}
						</ul>
					</QuietScrollArea>
				) : null}
			</div>
		</div>
	);
}
