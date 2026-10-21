import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useResourceEnvironment } from "../host";
import { type ResourceRenderer, rendererTestId } from "../registry";

export type RendererLayout = "split" | "unified";

export function RendererToggles({
	candidates,
	renderer,
	onRendererId,
	layout,
}: {
	candidates: readonly ResourceRenderer[];
	renderer: ResourceRenderer;
	onRendererId: (rendererId: string) => void;
	layout?: { value: RendererLayout; onChange: (layout: RendererLayout) => void } | undefined;
}) {
	const { mobile } = useResourceEnvironment();
	return (
		<>
			{candidates.length >= 2
				? candidates.map((candidate) => (
						<ToggleSegment
							key={candidate.id}
							testid={rendererTestId(candidate.id)}
							label={candidate.label}
							active={candidate.id === renderer.id}
							onClick={() => onRendererId(candidate.id)}
						/>
					))
				: null}
			{layout && renderer.capabilities.layout && !mobile ? (
				<>
					<ToggleSegment
						testid="diff-toggle-split"
						label="Split"
						active={layout.value === "split"}
						onClick={() => layout.onChange("split")}
					/>
					<ToggleSegment
						testid="diff-toggle-inline"
						label="Inline"
						active={layout.value === "unified"}
						onClick={() => layout.onChange("unified")}
					/>
				</>
			) : null}
		</>
	);
}
