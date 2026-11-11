import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const isLayoutRole = (value: string) => /^[a-z]+(?:-[a-z]+)+$/.test(value);

const twMerge = extendTailwindMerge<"focus-ring">({
	extend: {
		theme: { spacing: [isLayoutRole] },
		classGroups: { "focus-ring": ["focus-ring", "focus-ring-inset", "focus-ring-inset-deep"] },
		conflictingClassGroups: { "outline-style": ["focus-ring"] },
	},
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
