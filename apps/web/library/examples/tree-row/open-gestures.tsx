import { useState } from "react";
import { firstClickOnly } from "@/lib";
import { warmOnHover } from "@/panels/editorWarm";
import { TreeRow } from "@/panels/TreeRow";

const files = ["README.md", "package.json", "tsconfig.json"];

export default function OpenGestures() {
	const [opened, setOpened] = useState<{ name: string; intent: "preview" | "keep" } | null>(null);
	const [warmed, setWarmed] = useState<string | null>(null);
	return (
		<div className="flex w-full flex-col gap-8">
			<ul className="flex w-full max-w-[16rem] flex-col">
				{files.map((name) => (
					<li key={name}>
						<TreeRow
							testid="file-node"
							kind="file"
							active={opened?.name === name}
							label={name}
							onClick={firstClickOnly(() => setOpened({ name, intent: "preview" }))}
							onDoubleClick={() => setOpened({ name, intent: "keep" })}
							onWarm={(trigger) =>
								trigger === "focus"
									? setWarmed(`${name} · focus`)
									: warmOnHover(() => setWarmed(`${name} · hover`))
							}
						/>
					</li>
				))}
			</ul>
			<div className="flex gap-16 tr-text-metadata text-text-muted">
				<output>{opened ? `${opened.intent} · ${opened.name}` : "—"}</output>
				<output>{warmed ?? "—"}</output>
			</div>
		</div>
	);
}
