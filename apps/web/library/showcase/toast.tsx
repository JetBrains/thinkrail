import {
	RiAlertLine,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiInformationLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@thinkrail/ui/toast";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { type ToastVariant, toastIcons, toastVariantDocs } from "../content/components/toast";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const VARIANTS = Object.keys(toastVariantDocs) as ToastVariant[];

const ICONS: Record<ToastVariant, { Icon: typeof RiAlertLine; className: string }> = {
	info: { Icon: RiInformationLine, className: "text-feedback-info" },
	success: { Icon: RiCheckboxCircleLine, className: "text-feedback-success" },
	warning: { Icon: RiAlertLine, className: "text-feedback-warning" },
	error: { Icon: RiErrorWarningLine, className: "text-feedback-error" },
};

const COPY = {
	info: { title: "plan.checkAll.runningTitle", message: "plan.checkAll.runningMessage" },
	success: { title: "plan.review.startedTitle", message: "plan.review.startedMessage" },
	warning: { title: "updates.native.disabled.title", message: "updates.native.disabled.detail" },
	error: { title: "plan.copyFailed.title", message: "plan.copyFailed.message" },
} as const satisfies Record<ToastVariant, { title: string; message: string }>;

interface SpecimenConfig {
	variant: ToastVariant;
	title: boolean;
	action: boolean;
}

/** The Toaster composition, placed in the page (`static` viewport) and held open. */
function Specimen({ variant, title, action }: SpecimenConfig) {
	const t = useT();
	const { Icon, className } = ICONS[variant];
	return (
		<ToastProvider>
			<Toast variant={variant} open onOpenChange={() => {}} duration={Number.POSITIVE_INFINITY}>
				<div className="flex items-start gap-8">
					<Icon className={cn("mt-2 size-14 shrink-0", className)} aria-hidden />
					<div className="flex min-w-0 flex-1 flex-col gap-4">
						{title ? <ToastTitle>{t(COPY[variant].title)}</ToastTitle> : null}
						<ToastDescription className={title ? undefined : "text-text-default"}>
							{t(COPY[variant].message)}
						</ToastDescription>
					</div>
					<ToastClose />
				</div>
				{action ? (
					<div className="mt-12 flex justify-end">
						<ToastAction altText={t("panels.diffSurface.undo")} asChild>
							<Button variant="outline" size="m" onClick={() => {}}>
								{t("panels.diffSurface.undo")}
							</Button>
						</ToastAction>
					</div>
				) : null}
			</Toast>
			<ToastViewport className="static" />
		</ToastProvider>
	);
}

function Severities() {
	return (
		<Table
			head={["Variant", "Toast", "Icon", "Use it for"]}
			rows={VARIANTS.map((variant) => [
				<code key="variant" className="tr-code-text">
					{variant}
				</code>,
				<Specimen key="toast" variant={variant} title action={false} />,
				<code key="icon" className="tr-code-text">
					{toastIcons[variant]}
				</code>,
				<InlineMarkdown key="text" source={toastVariantDocs[variant]} />,
			])}
		/>
	);
}

function Lifetime() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [timer, setTimer] = useState<"idle" | "running" | "paused">("idle");
	return (
		<ToastProvider swipeDirection="right">
			<div className="flex flex-col items-start gap-12">
				<div className="flex items-center gap-12">
					<Button
						variant="outline"
						size="m"
						onClick={() => {
							setOpen(true);
							setTimer("running");
						}}
					>
						{t("common.copy")}
					</Button>
					<output className="tr-text-metadata text-text-muted" data-testid="toast-timer">
						{`timer: ${timer}`}
					</output>
				</div>
				<Toast
					variant="success"
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						if (!next) setTimer("idle");
					}}
					onPause={() => setTimer("paused")}
					onResume={() => setTimer("running")}
				>
					<div className="flex items-start gap-8">
						<RiCheckboxCircleLine
							className="mt-2 size-14 shrink-0 text-feedback-success"
							aria-hidden
						/>
						<div className="flex min-w-0 flex-1 flex-col gap-4">
							<ToastTitle>{t("plan.copied.title")}</ToastTitle>
							<ToastDescription>{t("plan.copied.message")}</ToastDescription>
						</div>
						<ToastClose />
					</div>
				</Toast>
				<ToastViewport className="static" />
			</div>
		</ToastProvider>
	);
}

function toConfig(values: PlaygroundValues): SpecimenConfig {
	return {
		variant: values.variant as ToastVariant,
		title: values.title === true,
		action: values.action === true,
	};
}

function code(values: PlaygroundValues): string {
	const { variant, title, action } = toConfig(values);
	const lines = [
		`<Toast variant="${variant}"${variant === "error" ? " duration={Number.POSITIVE_INFINITY}" : ""}>`,
		`\t<div className="flex items-start gap-8">`,
		`\t\t<${toastIcons[variant]} className="mt-2 size-14 shrink-0 ${ICONS[variant].className}" aria-hidden />`,
		`\t\t<div className="flex min-w-0 flex-1 flex-col gap-4">`,
		...(title ? [`\t\t\t<ToastTitle>{t("${COPY[variant].title}")}</ToastTitle>`] : []),
		title
			? `\t\t\t<ToastDescription>{t("${COPY[variant].message}")}</ToastDescription>`
			: `\t\t\t<ToastDescription className="text-text-default">{t("${COPY[variant].message}")}</ToastDescription>`,
		`\t\t</div>`,
		`\t\t<ToastClose />`,
		`\t</div>`,
		...(action
			? [
					`\t<div className="mt-12 flex justify-end">`,
					`\t\t<ToastAction altText={t("panels.diffSurface.undo")} asChild>`,
					`\t\t\t<Button variant="outline" size="m" onClick={undo}>`,
					`\t\t\t\t{t("panels.diffSurface.undo")}`,
					`\t\t\t</Button>`,
					`\t\t</ToastAction>`,
					`\t</div>`,
				]
			: []),
		`</Toast>`,
	];
	return lines.join("\n");
}

export const toastShowcase: Showcase = {
	sections: [
		{
			id: "variants",
			title: "Severities",
			description:
				"Every cell is the real Toast composed as `panels/Toaster` composes it. The variant sets only the border; the icon is the call site's, coloured with the same `feedback-*` role. The full look is the [Notices](#/notices) pattern.",
			Render: Severities,
		},
		{
			id: "states",
			title: "States",
			description:
				"A real five-second toast. Copy raises it; hover it or Tab into it and the timer pauses, leave and it resumes; drag it to the right to swipe it away; Escape or Dismiss closes it.",
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
		Preview: ({ values }) => <Specimen {...toConfig(values)} />,
		code,
	},
};
