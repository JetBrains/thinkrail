import type { Question } from "@/types/agent.ts";

interface QuestionTabBarProps {
  questions: Question[];
  activeIndex: number;
  answeredIndices: Set<number>;
  onTabClick: (index: number) => void;
}

export function QuestionTabBar({
  questions,
  activeIndex,
  answeredIndices,
  onTabClick,
}: QuestionTabBarProps) {
  return (
    <div className="chat-question-tabs">
      {questions.map((q, i) => (
        <button
          key={q.question}
          className={`chat-question-tab${i === activeIndex ? " chat-question-tab-active" : ""}${answeredIndices.has(i) ? " chat-question-tab-done" : ""}`}
          onClick={() => onTabClick(i)}
        >
          {answeredIndices.has(i) && <span className="chat-question-tab-check">{"\u2713"}</span>}
          {q.header}
        </button>
      ))}
    </div>
  );
}
