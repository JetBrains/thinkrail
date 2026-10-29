import { RiCheckLine, RiCodeSSlashLine, RiFileCopyLine } from "@remixicon/react";
import { IconButton } from "@thinkrail/ui/button";
import { type ComponentType, useEffect, useState } from "react";
import { InlineMarkdown } from "./Markdown";

export function DemoCard({
	id,
	testId,
	title,
	description,
	file,
	code,
	Demo,
}: {
	id: string;
	testId: string;
	title: string;
	description: string;
	file: string;
	code: string;
	Demo: ComponentType | undefined;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<article
			id={id}
			data-testid={testId}
			className="mb-16 flex scroll-mt-16 break-inside-avoid flex-col rounded-md border border-border-default bg-container-elevated-bg"
		>
			<div data-testid="example-preview" className="flex min-h-[5rem] items-center px-24 py-32">
				{Demo ? <Demo /> : null}
			</div>
			<div className="flex flex-col gap-8 border-border-default border-t px-24 pt-16 pb-12">
				<h3 className="tr-title-section text-text-default">{title}</h3>
				<p className="tr-text-ui text-text-muted">
					<InlineMarkdown source={description} />
				</p>
			</div>
			<div className="flex items-center justify-center gap-8 border-border-muted border-t border-dashed py-8">
				<IconButton
					icon={copied ? RiCheckLine : RiFileCopyLine}
					label={copied ? "Copied" : "Copy code"}
					data-testid="library-copy"
					onClick={() => {
						void navigator.clipboard?.writeText(code).then(() => setCopied(true));
					}}
				/>
				<IconButton
					icon={RiCodeSSlashLine}
					label={open ? "Hide code" : "Show code"}
					selected={open}
					aria-expanded={open}
					aria-controls={`${id}-code`}
					data-testid="library-show-code"
					onClick={() => setOpen((value) => !value)}
				/>
			</div>
			{open ? (
				<div id={`${id}-code`} className="border-border-default border-t bg-container-content-bg">
					<div className="border-border-muted border-b px-16 py-6 tr-text-metadata text-text-subtle">
						{file}
					</div>
					<pre className="overflow-x-auto p-16 tr-code-text text-text-default [tab-size:2]">
						<code>{code}</code>
					</pre>
				</div>
			) : null}
		</article>
	);
}
