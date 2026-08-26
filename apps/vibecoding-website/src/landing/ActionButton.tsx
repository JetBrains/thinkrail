type Props = {
	href: string;
	variant?: "primary" | "secondary" | "light";
	children: React.ReactNode;
	className?: string;
};

const base =
	"inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-[450] transition-colors";

const variants = {
	primary: "bg-primary text-primary-foreground transition-opacity hover:opacity-90",
	secondary: "border border-border text-text-default hover:bg-container-card-bg",
	light: "bg-text-strong text-background transition-opacity hover:opacity-90",
} as const;

export function ActionButton({ href, variant = "primary", children, className = "" }: Props) {
	return (
		<a href={href} className={`${base} ${variants[variant]} ${className}`}>
			{children}
		</a>
	);
}
