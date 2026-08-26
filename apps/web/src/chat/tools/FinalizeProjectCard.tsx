import { RiRocketLine as Rocket } from "@remixicon/react";
import type { ReactNode } from "react";
import type { ToolRenderProps } from "../toolRegistry";
import { strArg } from "./toolHelpers";

export function FinalizeProjectCard({ args, status }: ToolRenderProps): ReactNode {
	const name = strArg(args, "name");
	const failed = status === "error";
	return (
		<div className="flex items-start gap-4 tr-text-ui">
			<Rocket
				className={`mt-2 size-14 shrink-0 ${failed ? "text-feedback-error" : "text-feedback-success"}`}
			/>
			<div className="min-w-0">
				{failed ? (
					<span className="text-feedback-error">Couldn't finalize the project.</span>
				) : (
					<span className="text-text-muted">
						Project ready:{" "}
						<span className="tr-text-emphasis text-text-default">{name || "your project"}</span>
					</span>
				)}
			</div>
		</div>
	);
}
