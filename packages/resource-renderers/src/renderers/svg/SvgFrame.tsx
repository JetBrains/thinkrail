export function SvgFrame({ title, document }: { title: string; document: string }) {
	return (
		<iframe
			title={title}
			sandbox=""
			srcDoc={document}
			className="pointer-events-none h-full w-full border-0"
		/>
	);
}
