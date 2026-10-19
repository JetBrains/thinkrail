export function HtmlFrame({ title, document }: { title: string; document: string }) {
	return (
		<iframe
			title={title}
			sandbox=""
			srcDoc={document}
			className="h-full min-h-[360px] w-full border-0 bg-container-workspace-bg"
		/>
	);
}
