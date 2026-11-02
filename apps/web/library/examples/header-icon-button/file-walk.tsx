import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

const files = ["src/app.ts", "src/store.ts", "README.md"];

export default function FileWalk() {
	const t = useT();
	const [index, setIndex] = useState(0);
	return (
		<div className="flex items-center gap-4">
			<HeaderIconButton
				testid="changes-review-prev"
				label={t("changes.review.previousFile")}
				disabled={index === 0}
				onClick={() => setIndex(index - 1)}
				icon={RiArrowLeftSLine}
			/>
			<span className="tr-text-metadata tabular-nums text-text-muted">
				{index + 1} / {files.length}
			</span>
			<HeaderIconButton
				testid="changes-review-next"
				label={t("changes.review.nextFile")}
				disabled={index >= files.length - 1}
				onClick={() => setIndex(index + 1)}
				icon={RiArrowRightSLine}
			/>
		</div>
	);
}
