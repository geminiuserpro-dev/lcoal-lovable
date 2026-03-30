import { useState, useEffect } from "react";
import { Zap, Crown, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { CreditsService, UserCredits } from "@/services/CreditsService";
import { useFirebase } from "@/components/FirebaseProvider";

export const CreditsIndicator = ({ onUpgrade }: { onUpgrade?: () => void }) => {
  const { user } = useFirebase();
  const [credits, setCredits] = useState<UserCredits | null>(null);

  useEffect(() => {
    if (!user) return;
    CreditsService.getCredits().then(setCredits).catch(() => {});
  }, [user]);

  if (!credits) return null;

  const pct = credits.plan === 'free'
    ? Math.round((credits.creditsUsed / 30) * 100)
    : Math.round((credits.creditsUsed / (credits.plan === 'pro' ? 500 : 2000)) * 100);

  const isLow = pct >= 80;
  const isEmpty = credits.credits <= 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
        isEmpty
          ? "border-red-500/40 bg-red-500/10 text-red-500"
          : isLow
          ? "border-yellow-500/30 bg-yellow-500/8 text-yellow-600 dark:text-yellow-400"
          : "border-border/50 bg-muted/40 text-muted-foreground hover:border-primary/30"
      }`}
      onClick={onUpgrade}
    >
      {isEmpty ? (
        <AlertTriangle size={11} className="shrink-0" />
      ) : credits.plan !== 'free' ? (
        <Crown size={11} className="shrink-0 text-yellow-500" />
      ) : (
        <Zap size={11} className="shrink-0" />
      )}
      <span>
        {isEmpty ? "No credits" : `${credits.credits} credits`}
      </span>
      {credits.plan === 'free' && (
        <div className="w-12 h-1 rounded-full bg-muted-foreground/20 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isEmpty ? "bg-red-500" : isLow ? "bg-yellow-500" : "bg-primary"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </motion.div>
  );
};

export default CreditsIndicator;
