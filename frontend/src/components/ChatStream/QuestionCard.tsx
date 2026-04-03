import { useState, useRef, useCallback, useEffect } from "react";
import type { Question } from "@/types/agent.ts";
import { isMod, modLabel } from "@/utils/platform.ts";
import { AnsweredTable } from "./AnsweredTable.tsx";
import { QuestionTabBar } from "./QuestionTabBar.tsx";
import { QuestionOptionsPanel } from "./QuestionOptionsPanel.tsx";
import { QuestionPreviewPanel } from "./QuestionPreviewPanel.tsx";

interface QuestionCardProps {
  questions: Question[];
  answered: boolean;
  interrupted?: boolean;
  selectedAnswers?: Record<string, string>;
  onSubmit: (response: Record<string, unknown>) => void;
}

export function QuestionCard({
  questions,
  answered,
  interrupted,
  selectedAnswers,
  onSubmit,
}: QuestionCardProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [highlighted, setHighlighted] = useState<Record<number, number>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, 0])),
  );
  const [selectedSingle, setSelectedSingle] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, null])),
  );
  const [checkedItems, setCheckedItems] = useState<Record<number, Set<number>>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, new Set<number>()])),
  );
  const [otherText, setOtherText] = useState<Record<number, string>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, ""])),
  );
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  // Focus container on mount so keyboard works immediately
  useEffect(() => {
    if (!answered) containerRef.current?.focus();
  }, [answered]);

  const q = questions[activeTab];
  const isMulti = q?.multiSelect ?? false;
  const optionCount = (q?.options.length ?? 0) + 1; // +1 for "Other"
  const otherIndex = q?.options.length ?? 0;

  const getAnswerForQuestion = useCallback(
    (qIdx: number): string | null => {
      const question = questions[qIdx];
      if (question.multiSelect) {
        const checked = checkedItems[qIdx];
        if (!checked || checked.size === 0) return null;
        const labels: string[] = [];
        for (const idx of checked) {
          if (idx === question.options.length) {
            labels.push(`Other: ${otherText[qIdx] || ""}`);
          } else {
            labels.push(question.options[idx].label);
          }
        }
        return labels.join(", ");
      } else {
        const sel = selectedSingle[qIdx];
        if (sel === null) return null;
        if (sel === question.options.length) {
          return `Other: ${otherText[qIdx] || ""}`;
        }
        return question.options[sel].label;
      }
    },
    [questions, selectedSingle, checkedItems, otherText],
  );

  const answeredIndices = new Set<number>();
  for (let i = 0; i < questions.length; i++) {
    if (getAnswerForQuestion(i) !== null) answeredIndices.add(i);
  }

  // Reset confirming when tab changes or answers change
  useEffect(() => setConfirmingSubmit(false), [activeTab, answeredIndices.size]);

  const submitAll = useCallback(() => {
    const answers: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      const a = getAnswerForQuestion(i);
      if (a !== null) answers[questions[i].question] = a;
    }
    onSubmit({ questions, answers });
  }, [questions, getAnswerForQuestion, onSubmit]);

  const handleSubmit = useCallback(() => {
    if (answeredIndices.size < questions.length && !confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    submitAll();
  }, [answeredIndices.size, questions.length, confirmingSubmit, submitAll]);

  const advanceToNext = useCallback(() => {
    // Only auto-advance to the next unanswered question in multi-question flows.
    // Never auto-submit — user must explicitly click Submit.
    for (let offset = 1; offset < questions.length; offset++) {
      const next = (activeTab + offset) % questions.length;
      if (!answeredIndices.has(next)) {
        setActiveTab(next);
        return;
      }
    }
  }, [activeTab, questions.length, answeredIndices]);

  const handleOptionClick = useCallback(
    (index: number) => {
      setHighlighted((prev) => ({ ...prev, [activeTab]: index }));
      if (isMulti) {
        setCheckedItems((prev) => {
          const next = new Set(prev[activeTab]);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          return { ...prev, [activeTab]: next };
        });
      } else {
        setSelectedSingle((prev) => ({ ...prev, [activeTab]: index }));
        // Auto-advance for single-select
        setTimeout(() => advanceToNext(), 150);
      }
      if (index === otherIndex) {
        setTimeout(() => otherInputRef.current?.focus(), 0);
      }
    },
    [activeTab, isMulti, otherIndex, advanceToNext],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // When other input is focused, only handle Escape
      if (document.activeElement === otherInputRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          containerRef.current?.focus();
        }
        return;
      }

      if (isMod(e) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setActiveTab((prev) => (prev - 1 + questions.length) % questions.length);
          break;
        case "ArrowRight":
          e.preventDefault();
          setActiveTab((prev) => (prev + 1) % questions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlighted((prev) => ({
            ...prev,
            [activeTab]: ((prev[activeTab] ?? 0) - 1 + optionCount) % optionCount,
          }));
          break;
        case "ArrowDown":
          e.preventDefault();
          setHighlighted((prev) => ({
            ...prev,
            [activeTab]: ((prev[activeTab] ?? 0) + 1) % optionCount,
          }));
          break;
        case "Enter": {
          e.preventDefault();
          const hi = highlighted[activeTab] ?? 0;
          handleOptionClick(hi);
          break;
        }
      }
    },
    [activeTab, questions.length, optionCount, highlighted, handleOptionClick, handleSubmit],
  );

  // Answered state
  if (answered && (selectedAnswers || interrupted)) {
    return (
      <div className="chat-question chat-question-answered">
        <div className="chat-question-answered-header-row">
          <span className="chat-question-header">AskUserQuestion</span>
          <span className={`chat-question-answered-done${interrupted ? " chat-question-answered-interrupted" : ""}`}>
            {interrupted ? "\u2718 interrupted" : "\u2713 done"}
          </span>
        </div>
        {!interrupted && selectedAnswers && (
          <AnsweredTable questions={questions} answers={selectedAnswers} />
        )}
      </div>
    );
  }

  // Get description for currently highlighted option
  const hi = highlighted[activeTab] ?? 0;
  const previewDesc =
    hi < (q?.options.length ?? 0)
      ? (q?.options[hi]?.description ?? "")
      : "";

  return (
    <div
      className="chat-question"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {questions.length > 1 && (
        <QuestionTabBar
          questions={questions}
          activeIndex={activeTab}
          answeredIndices={answeredIndices}
          onTabClick={setActiveTab}
        />
      )}

      {q && (
        <>
          <div className="chat-question-header">{q.header}</div>
          <div className="chat-question-text">{q.question}</div>

          <div className="chat-question-body">
            <QuestionOptionsPanel
              question={q}
              highlightedIndex={highlighted[activeTab] ?? 0}
              selectedIndex={selectedSingle[activeTab] ?? null}
              checkedIndices={checkedItems[activeTab] ?? new Set()}
              otherText={otherText[activeTab] ?? ""}
              onOptionClick={handleOptionClick}
              onOtherTextChange={(text) =>
                setOtherText((prev) => ({ ...prev, [activeTab]: text }))
              }
              otherInputRef={otherInputRef}
            />
            <QuestionPreviewPanel description={previewDesc} />
          </div>

          <div className="chat-question-submit-hint">
            {confirmingSubmit ? (
              <>
                <span className="chat-question-warning">
                  {questions.length - answeredIndices.size} of {questions.length} unanswered
                </span>
                <button className="chat-btn chat-btn-primary" onClick={submitAll}>
                  Submit anyway
                </button>
                <button className="chat-btn" onClick={() => setConfirmingSubmit(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {questions.length > 1 && answeredIndices.size < questions.length && (
                  <button className="chat-btn" onClick={advanceToNext}>
                    Next &rarr;
                  </button>
                )}
                <button className="chat-btn chat-btn-primary" onClick={handleSubmit}>
                  {questions.length === 1 ? "Submit" : "Submit all"}
                </button>
                <span>
                  {isMulti ? "Enter toggles" : "Enter selects"}
                  {questions.length > 1 ? " / \u2190\u2192 switches" : ""}
                  {` / ${modLabel("Enter")} submits`}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
