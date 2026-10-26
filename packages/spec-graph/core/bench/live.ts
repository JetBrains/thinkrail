import { join } from "node:path";
import { SpecIndex } from "../index.ts";
import questions from "./questions.json";
import { formatReport, scoreQuestions } from "./score.ts";

const root = process.argv[2] ?? join(import.meta.dir, "../../../..");
const entries = new SpecIndex(root).contentEntries();
console.log(`${entries.length} specs under ${root}\n`);
console.log(formatReport(scoreQuestions(entries, questions.questions)));
console.log("\nExpected misses (paraphrases with no shared words):");
console.log(formatReport(scoreQuestions(entries, questions.misses)));
