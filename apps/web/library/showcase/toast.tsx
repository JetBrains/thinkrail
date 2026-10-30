import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useAppStore } from "@/store";
import { type ToastVariant, toastIcons, toastVariantDocs } from "../content/components/toast";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const VARIANTS = Object.keys(toastVariantDocs) as ToastVariant[];

const COPY = {
	info: { title: "plan.checkAll.runningTitle", message: "plan.checkAll.runningMessage" },
	success: { title: "plan.review.startedTitle", message: "plan.review.startedMessage" },
	warning: { title: "updates.native.disabled.title", message: "updates.native.disabled.detail" },
	error: { title: "plan.copyFailed.title", message: "plan.copyFailed.message" },
} as const satisfies Record<ToastVariant, { title: string; message: string }>;

interface Request {
	variant: ToastVariant;
	title: boolean;
	action: boolean;
}

function ShowToast({ variant, title, action }: Request) {
	const t = useT();
	const pushToast = useAppStore((s) => s.pushToast);
	return (
		<Button
			variant="outline"
			size="m"
			onClick={() =>
				pushToast({
					variant,
					message: t(COPY[variant].message),
					...(title ? { title: t(COPY[variant].title) } : {}),
					...(action ? { action: { label: t("panels.diffSurface.undo"), onClick: () => {} } } : {}),
				})
			}
		>
			{variant}
		</Button>
	);
}

function Severities() {
	return (
		<Table
			head={["Variant", "Raise it", "Icon", "Use it for"]}
			rows={VARIANTS.map((variant) => [
				<code key="variant" className="tr-code-text">
					{variant}
				</code>,
				<ShowToast key="toast" variant={variant} title action={false} />,
				<code key="icon" className="tr-code-text">
					{toastIcons[variant]}
				</code>,
				<InlineMarkdown key="text" source={toastVariantDocs[variant]} />,
			])}
		/>
	);
}

function Lifetime() {
	return <ShowToast variant="success" title action={false} />;
}

function toRequest(values: PlaygroundValues): Request {
	return {
		variant: values.variant as ToastVariant,
		title: values.title === true,
		action: values.action === true,
	};
}

function code(values: PlaygroundValues): string {
	const { variant, title, action } = toRequest(values);
	const fields = [
		`\tvariant: "${variant}",`,
		`\tmessage: t("${COPY[variant].message}"),`,
		...(title ? [`\ttitle: t("${COPY[variant].title}"),`] : []),
		...(action ? ['\taction: { label: t("panels.diffSurface.undo"), onClick: undo },'] : []),
	];
	return `import { useAppStore } from "@/store";\n\nconst pushToast = useAppStore((s) => s.pushToast);\n\npushToast({\n${fields.join("\n")}\n});`;
}

export const toastShowcase: Showcase = {
	sections: [
		{
			id: "variants",
			title: "Severities",
			description:
				"Each button raises a real toast through `pushToast`, rendered by the app's own `Toaster` in the corner of this page. The variant sets the border; `Toaster` picks the icon. The full look is the [Notices](#/notices) pattern.",
			Render: Severities,
		},
		{
			id: "states",
			title: "States",
			description:
				"Raise a real five-second toast, then hover it or Tab into it and the timer pauses; leave and it resumes; drag it to the right to swipe it away; Escape or Dismiss closes it. Errors stay until dismissed.",
			Render: Lifetime,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "variant", options: VARIANTS },
			{ kind: "flag", name: "title" },
			{ kind: "flag", name: "action" },
		],
		initial: { variant: "info", title: true, action: false },
		Preview: ({ values }) => <ShowToast {...toRequest(values)} />,
		code,
	},
};
