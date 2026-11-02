import { StreamIndicator } from "@/chat/StreamIndicator";

export default function StreamFooter() {
	return (
		<div className="flex w-full max-w-sm flex-col gap-4">
			<StreamIndicator status={{ phase: "working" }} />
			<StreamIndicator status={{ phase: "thinking" }} />
			<StreamIndicator status={{ phase: "running-tool", toolName: "bash" }} />
		</div>
	);
}
