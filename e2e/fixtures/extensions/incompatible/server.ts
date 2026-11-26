import { writeFileSync } from "node:fs";

writeFileSync(new URL("./server-ran", import.meta.url), "the incompatible server half ran");

export default { name: "e2e-ext-incompatible", extensions: [] };
