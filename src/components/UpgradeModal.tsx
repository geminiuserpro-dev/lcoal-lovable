import { motion, AnimatePresence } from "motion/react";
import { X, Zap, Crown, Building2, Check } from "lucide-react";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    icon: Zap,
    color: "border-border",
    badge: "",
    features: ["30 credits/month", "Gemini 3 Flash", "Public projects", "Community support"],
    cta: "Current plan",
    disabled: true,
    priceId: "",
  },
  {
    name: "Pro",
    price: "$20",
    period: "/month",
    icon: Crown,
    color: "border-primary",
    badge: "Most popular",
    features: ["500 credits/month", "Claude Sonnet 4.6", "Private projects", "GitHub sync", "Deploy to Vercel", "Priority support"],
    cta: "Upgrade to Pro",
    disabled: false,
    priceId: "price_pro_monthly",
  },
  {
    name: "Team",
    price: "$60",
    period: "/month",
    icon: Building2,
    color: "border-border",
    badge: "",
    features: ["2000 credits/month", "All Pro features", "5 team seats", "Shared projects", "Analytics dashboard", "Dedicated support"],
    cta: "Upgrade to Team",
    disabled: false,
    priceId: "price_team_monthly",
  },
];

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

const UpgradeModal = ({ open, onClose }: UpgradeModalProps) => {
  const handleUpgrade = async (priceId: string) => {
    try {
      const resp = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId,
          successUrl: `${window.location.origin}/?upgraded=true`,
          cancelUrl: window.location.href,
        }),
      });
      const { url } = await resp.json();
      if (url) window.location.href = url;
    } catch (e) {
      console.error("Checkout failed", e);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: "spring", bounce: 0.2 }}
            className="bg-background border border-border rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <div>
                <h2 className="text-2xl font-bold">Upgrade your plan</h2>
                <p className="text-muted-foreground text-sm mt-1">Get more credits and unlock premium features</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors">
                <X size={14} />
              </button>
            </div>

            {/* Plans */}
            <div className="grid grid-cols-3 gap-4 px-8 pb-8">
              {plans.map(plan => {
                const Icon = plan.icon;
                return (
                  <div
                    key={plan.name}
                    className={`relative rounded-2xl border-2 p-5 flex flex-col gap-4 ${plan.color} ${plan.badge ? "bg-primary/3" : "bg-muted/20"}`}
                  >
                    {plan.badge && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider">
                        {plan.badge}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${plan.badge ? "bg-primary/15" : "bg-muted"}`}>
                        <Icon size={15} className={plan.badge ? "text-primary" : "text-muted-foreground"} />
                      </div>
                      <span className="font-semibold">{plan.name}</span>
                    </div>
                    <div>
                      <span className="text-3xl font-bold">{plan.price}</span>
                      <span className="text-muted-foreground text-sm">{plan.period}</span>
                    </div>
                    <ul className="space-y-2 flex-1">
                      {plan.features.map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Check size={11} className="text-primary shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      disabled={plan.disabled}
                      onClick={() => !plan.disabled && handleUpgrade(plan.priceId)}
                      className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        plan.disabled
                          ? "bg-muted text-muted-foreground cursor-default"
                          : plan.badge
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "bg-muted hover:bg-muted/80 text-foreground border border-border"
                      }`}
                    >
                      {plan.cta}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UpgradeModal;
