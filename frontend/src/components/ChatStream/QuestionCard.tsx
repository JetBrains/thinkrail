import { useState } from "react";
import type { Question } from "@/types/agent.ts";

interface QuestionCardProps {
  questions: Question[];
  answered: boolean;
  selectedAnswers?: Record<string, string>;
  onSubmit: (response: Record<string, unknown>) => void;
}

export function QuestionCard({
  questions,
  answered,
  selectedAnswers,
  onSubmit,
}: QuestionCardProps) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [textInput, setTextInput] = useState("");

  const handleSelect = (questionText: string, label: string, multiSelect: boolean) => {
    if (answered) return;
    setSelections((prev) => {
      if (multiSelect) {
        const current = prev[questionText] ?? "";
        const labels = current ? current.split(", ") : [];
        const idx = labels.indexOf(label);
        if (idx >= 0) labels.splice(idx, 1);
        else labels.push(label);
        return { ...prev, [questionText]: labels.join(", ") };
      }
      return { ...prev, [questionText]: label };
    });
  };

  const handleSubmit = () => {
    if (answered) return;
    // If any question has no options (free-text prompt), use the text input
    const hasEmptyOptions = questions.some((q) => q.options.length === 0);
    if (hasEmptyOptions && textInput.trim()) {
      // Backend expects { text: "..." } for free-text, plus answers dict
      onSubmit({ text: textInput.trim(), answers: selections });
    } else {
      // Backend expects { questions: [...], answers: { questionText: selectedLabel } }
      onSubmit({ questions, answers: selections });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Check if this is a free-text prompt (question with empty options)
  const isFreeText = questions.length > 0 && questions.every((q) => q.options.length === 0);

  return (
    <div className={`chat-question ${answered ? "chat-question-answered" : ""}`}>
      {questions.map((q) => (
        <div key={q.question} className="chat-question-group">
          <div className="chat-question-header">{q.header}</div>
          <div className="chat-question-text">{q.question}</div>
          {q.options.length > 0 ? (
            <div className="chat-question-options">
              {q.options.map((opt) => {
                const display = answered ? selectedAnswers : selections;
                const isSelected = display?.[q.question]?.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    className={`chat-option ${isSelected ? "chat-option-selected" : ""}`}
                    onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                    disabled={answered}
                  >
                    <span className="chat-option-radio">
                      {isSelected ? (q.multiSelect ? "\u2611" : "\u25CF") : (q.multiSelect ? "\u2610" : "\u25CB")}
                    </span>
                    <div>
                      <div className="chat-option-label">{opt.label}</div>
                      <div className="chat-option-desc">{opt.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !answered ? (
            <textarea
              className="chat-question-textarea"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response..."
              rows={3}
              autoFocus
            />
          ) : (
            <div className="chat-question-answer">
              {selectedAnswers?.text ?? textInput}
            </div>
          )}
        </div>
      ))}
      {!answered && (
        <div className="chat-question-actions">
          <button
            className="chat-btn chat-btn-primary"
            onClick={handleSubmit}
            disabled={isFreeText && !textInput.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
