import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: (QuestionOption | string)[];
  multiSelect?: boolean;
  allowOther?: boolean;
}

interface QuestionsCardProps {
  questions: Question[];
  onSubmit: (answers: Record<number, string[]>) => void;
  onSkip: () => void;
}

export const QuestionsCard = ({ questions, onSubmit, onSkip }: QuestionsCardProps) => {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [otherValues, setOtherValues] = useState<Record<number, string>>({});
  const [direction, setDirection] = useState(1);

  const q = questions[step];
  if (!q) return null;

  const current = answers[step] || [];
  const isMulti = q.multiSelect;
  const isLast = step === questions.length - 1;
  const hasAnswer = current.length > 0;

  const toggle = (label: string) => {
    setAnswers(prev => {
      const cur = prev[step] || [];
      if (isMulti) {
        return { ...prev, [step]: cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label] };
      }
      return { ...prev, [step]: cur[0] === label ? [] : [label] };
    });
  };

  const goNext = () => {
    if (!hasAnswer) return;
    if (isLast) { onSubmit(answers); return; }
    setDirection(1);
    setStep(s => s + 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mx-1 mb-1 rounded-2xl border border-border/60 bg-background overflow-hidden shadow-xl shadow-black/5"
    >
      {/* Header bar */}
      <div className="px-4 pt-3.5 pb-2.5 border-b border-border/40 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-foreground">Questions</span>
        <span className="text-[11px] text-muted-foreground/40">{step + 1} of {questions.length}</span>
      </div>

      {/* Animated question body */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div key={step} custom={direction}
          initial={{ opacity: 0, x: direction * 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -16 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="px-4 pt-3 pb-2">

          <div className="flex items-start justify-between gap-4 mb-3">
            <p className="text-[13px] font-medium text-foreground leading-snug">{q.question}</p>
            <span className="shrink-0 text-[11px] text-muted-foreground/50 mt-0.5 whitespace-nowrap">
              {isMulti ? "Select multiple answers" : "Select one answer"}
            </span>
          </div>

          <div className="space-y-1.5">
            {q.options.map((opt) => {
              const label = typeof opt === "string" ? opt : opt.label;
              const desc = typeof opt === "string" ? "" : opt.description;
              const sel = current.includes(label);

              return (
                <button key={label} onClick={() => toggle(label)}
                  className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all duration-150 ${
                    sel ? "border-foreground/25 bg-foreground/[0.04]" : "border-border/50 hover:border-border hover:bg-muted/30"
                  }`}>
                  {/* Indicator */}
                  <div className={`shrink-0 mt-0.5 flex items-center justify-center transition-all ${isMulti ? "w-4 h-4 rounded-md border-2" : "w-4 h-4 rounded-full border-2"} ${sel ? "border-foreground bg-foreground" : "border-muted-foreground/30"}`}>
                    {sel && !isMulti && <div className="w-1.5 h-1.5 rounded-full bg-background" />}
                    {sel && isMulti && (
                      <svg width="8" height="7" viewBox="0 0 8 7" fill="none">
                        <path d="M1 3.5L3 5.5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <span className="text-[13px] font-medium text-foreground">{label}</span>
                    {desc && <span className="text-[11px] text-muted-foreground/60 block mt-0.5">{desc}</span>}
                  </div>
                </button>
              );
            })}

            {q.allowOther && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40">
                <div className={`shrink-0 w-4 h-4 ${isMulti ? "rounded-md" : "rounded-full"} border-2 border-muted-foreground/30`} />
                <input value={otherValues[step] || ""} placeholder="Other"
                  onChange={e => {
                    const val = e.target.value;
                    setOtherValues(p => ({ ...p, [step]: val }));
                    setAnswers(p => {
                      const cur = (p[step] || []).filter(x => !x.startsWith("Other:"));
                      return { ...p, [step]: val ? [...cur, `Other: ${val}`] : cur };
                    });
                  }}
                  className="flex-1 text-[13px] bg-transparent outline-none text-foreground placeholder:text-muted-foreground/40" />
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <div className="px-4 pb-4 flex items-center gap-2 mt-1">
        {step > 0 && (
          <button onClick={() => { setDirection(-1); setStep(s => s - 1); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-border/50 hover:bg-muted/60 text-muted-foreground transition-colors">
            <ChevronLeft size={13} />
          </button>
        )}
        <button onClick={onSkip} className="text-[12px] text-muted-foreground/40 hover:text-muted-foreground transition-colors px-1">
          Skip {questions.length > 1 && step < questions.length - 1 ? "all" : ""}
        </button>

        <div className="flex-1 flex items-center justify-center gap-1">
          {questions.length > 1 && questions.map((_, i) => (
            <button key={i} onClick={() => { setDirection(i > step ? 1 : -1); setStep(i); }}
              className={`rounded-full transition-all duration-200 ${i === step ? "w-5 h-1.5 bg-foreground" : i < step ? "w-1.5 h-1.5 bg-foreground/40" : "w-1.5 h-1.5 bg-muted-foreground/20"}`} />
          ))}
        </div>

        <button onClick={goNext} disabled={!hasAnswer}
          className={`flex items-center gap-1 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
            hasAnswer ? "bg-foreground text-background hover:opacity-90" : "bg-muted/60 text-muted-foreground/30 cursor-not-allowed"
          }`}>
          {isLast ? "Submit" : "Next"}
          {!isLast && <ChevronRight size={12} />}
        </button>
      </div>
    </motion.div>
  );
};

export default QuestionsCard;
