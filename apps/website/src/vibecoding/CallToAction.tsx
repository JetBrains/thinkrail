import { InstallPicker } from "./InstallPicker";
import { Reveal } from "./Reveal";
import { Subtitle } from "./Subtitle";

export function CallToAction() {
	return (
		<section
			id="cta"
			className="relative overflow-hidden border-b border-border-muted bg-container-header-bg"
		>
			<div className="relative mx-auto max-w-[1200px] px-6 py-16 text-center sm:py-32">
				<Reveal>
					<p className="label-mono">Next step</p>
					<h2 className="font-display mx-auto mt-6 max-w-3xl text-3xl font-normal sm:text-4xl">
						Give your AI agents a system.
					</h2>
					<Subtitle className="mx-auto mt-6">
						Move from disconnected prompts to a clear, predictable, and fully visible environment
						for automated code generation.
					</Subtitle>

					<div className="mx-auto mt-10 max-w-[600px] text-left">
						<InstallPicker />
					</div>
				</Reveal>
			</div>
		</section>
	);
}
