import { type ReactNode, useRef } from "react";
import { useChatActions } from "../ChatActions";
import { DefaultToolRenderer, type ToolRenderProps } from "../toolRegistry";
import { readNextStepItems } from "./nextSteps";

const CHIP =
	"flex min-w-0 max-w-full items-center rounded-[var(--radius-sm)] border border-transparent bg-clip-padding bg-bubble-user-bg px-8 py-2 text-text-muted tr-text-reading outline-none transition-colors hover:border-bubble-user-border hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary";

export function NextStepChips(props: ToolRenderProps): ReactNode {
	const actions = useChatActions();
	const activated = useRef(false);

	if (props.status !== "done") return <DefaultToolRenderer {...props} />;

	const items = readNextStepItems(props.result);
	if (items.length === 0) return null;

	return (
		<div
			data-testid="next-steps"
			data-count={items.length}
			className="flex w-full shrink-0 flex-wrap gap-4 px-12 pt-4"
		>
			{items.map((item, index) => (
				<button
					key={item.label}
					type="button"
					data-testid="next-step-chip"
					data-index={index}
					onClick={() => {
						if (activated.current || !actions) return;
						activated.current = true;
						actions.sendPrompt(item.prompt);
					}}
					className={CHIP}
				>
					<span className="truncate">{item.label}</span>
				</button>
			))}
		</div>
	);
}
