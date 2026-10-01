import { registerResourceRenderer } from "@/resources";
import { binaryRenderer } from "./binary";
import { codeRenderer } from "./code";
import { markdownRenderer } from "./markdown";

registerResourceRenderer(codeRenderer);
registerResourceRenderer(markdownRenderer);
registerResourceRenderer(binaryRenderer);
