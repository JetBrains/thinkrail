import { button } from "./button";
import { iconButton } from "./iconButton";
import type { ComponentDoc, GuidePage } from "./types";
import { using } from "./using";

export const guides: readonly GuidePage[] = [using];
export const components: readonly ComponentDoc[] = [button, iconButton];
