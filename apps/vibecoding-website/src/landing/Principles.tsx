import { Reveal } from "./Reveal";
import { Subtitle } from "./Subtitle";
import { View, ListTodo, ListTree, BookOpenText } from "lucide-react";

const principles = [
  {
    n: "01",
    Icon: View,
    title: "See what your agents are doing",
    body: "No black boxes. Every terminal prompt, source code lookup, and tool invocation is rendered in real-time. Know exactly what your agents are exploring.",
  },
  {
    n: "02",
    Icon: ListTodo,
    title: "Clarify requirements before building",
    body: "Agents write a dry-run plan and architectural outline before writing code. Review the approach, adjust the constraints, and authorize with confidence.",
  },
  {
    n: "03",
    Icon: ListTree,
    title: "Run multiple agents without the mess",
    body: "Each task runs inside its own isolated Git worktree. Run five distinct features in parallel without dealing with lock files, dirty indexes, or branch switching.",
  },
  {
    n: "04",
    Icon: BookOpenText,
    title: "Keep your project's memory",
    body: "Maintain an active knowledge map of your codebase. When agents finish, they document how they solved the task, preserving reasoning for the next run.",
  },
];

export function Principles() {
  return (
    <section id="features" className="scroll-mt-16 border-b border-border-muted bg-container-header-bg">
      <div className="mx-auto max-w-[1200px] px-6 py-12 sm:py-24">
        <Reveal>
          <p className="label-mono">// Foundational principles</p>
          <h2 className="font-display mt-4 text-2xl font-normal sm:text-3xl lg:whitespace-nowrap">
            Designed for high-trust development
          </h2>
          <Subtitle className="mt-5" style={{ maxWidth: 650 }}>
            {"We do not believe in fully-autonomous software engineering.\u00a0\nWe believe in automated agent orchestration backed by strict human gatekeeping."}
          </Subtitle>
        </Reveal>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((p, i) => (
            <Reveal key={p.n} delay={i * 70} className="h-full">

              <article className="h-full rounded-lg border border-border bg-container-card-bg p-5">
                <p.Icon className="text-primary" size={24} strokeWidth={1.5} aria-hidden="true" />
                <h3 className="mt-6 text-sm font-semibold">{p.title}</h3>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">{p.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}
