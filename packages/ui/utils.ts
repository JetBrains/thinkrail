import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const isLayoutRole = (value: string) => /^[a-z]+(?:-[a-z]+)+$/.test(value);

const twMerge = extendTailwindMerge({ extend: { theme: { spacing: [isLayoutRole] } } });

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
