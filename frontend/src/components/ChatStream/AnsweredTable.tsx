import type { Question } from "@/types/agent.ts";

interface AnsweredTableProps {
  questions: Question[];
  answers: Record<string, string>;
}

export function AnsweredTable({ questions, answers }: AnsweredTableProps) {
  return (
    <div className="chat-question-answered-table">
      {questions.map((q) => (
        <div key={q.question} className="chat-question-answered-row">
          <span className="chat-question-answered-header">{q.header}:</span>
          <span className="chat-question-answered-question">{q.question}</span>
          <span className="chat-question-answered-arrow">{"\u2192"} <span className="chat-question-answered-answer">{answers[q.question] ?? ""}</span></span>
        </div>
      ))}
    </div>
  );
}
