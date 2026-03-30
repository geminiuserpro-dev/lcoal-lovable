import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Code, Sparkles, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const steps = [
  {
    icon: Sparkles,
    title: "Describe what you want to build",
    desc: "Type a prompt like \"Build a task manager with dark mode\" and watch your app come to life.",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: Code,
    title: "AI writes the code for you",
    desc: "Claude and Gemini collaborate — reading files, writing components, adding dependencies.",
    color: "from-blue-500 to-cyan-500",
  },
  {
    icon: Zap,
    title: "Preview, edit, and publish",
    desc: "See your app live as it's built. Tweak anything with more prompts. Deploy when ready.",
    color: "from-orange-500 to-amber-500",
  },
];

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

const OnboardingModal = ({ open, onClose }: OnboardingModalProps) => {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  const handleFinish = () => {
    localStorage.setItem("onboarding_complete", "true");
    onClose();
    navigate("/editor");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", bounce: 0.25 }}
            className="bg-background border border-border rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5 pt-6 pb-2">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`rounded-full transition-all ${
                    i === step ? "w-6 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>

            {/* Step content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="px-8 pt-6 pb-8 flex flex-col items-center text-center"
              >
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${steps[step].color} flex items-center justify-center mb-6 shadow-lg`}>
                  {(() => { const Icon = steps[step].icon; return <Icon size={28} className="text-white" />; })()}
                </div>
                <h2 className="text-xl font-bold mb-3">{steps[step].title}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{steps[step].desc}</p>
              </motion.div>
            </AnimatePresence>

            {/* Actions */}
            <div className="px-8 pb-8 flex items-center gap-3">
              {step < steps.length - 1 ? (
                <>
                  <button
                    onClick={handleFinish}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors mr-auto"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => setStep(s => s + 1)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    Next <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                <button
                  onClick={handleFinish}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
                >
                  <CheckCircle2 size={16} />
                  Start building
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OnboardingModal;
