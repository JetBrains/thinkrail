import { registerResourceRenderer } from "@/resources";
import { binaryRenderer } from "./binary";
import { codeRenderer } from "./code";
import { csvRenderer } from "./csv";
import { imageRenderer } from "./image";
import { jsonRenderer } from "./json";
import { markdownRenderer } from "./markdown";
import { svgRenderer } from "./svg";

registerResourceRenderer(codeRenderer);
registerResourceRenderer(svgRenderer);
registerResourceRenderer(imageRenderer);
registerResourceRenderer(csvRenderer);
registerResourceRenderer(jsonRenderer);
registerResourceRenderer(markdownRenderer);
registerResourceRenderer(binaryRenderer);
