import { motion } from "motion/react";
import { Check, Zap, Crown, Building2, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useState } from "react";
import { toast } from "sonner";

const plans = [
  {
    name: "Free",
    price: { monthly: "$0", annual: "$0" },
    period: "/month",
    icon: Zap,
    color: "border-border",
    highlight: false,
    badge: "",
    description: "Perfect for experimenting and side projects.",
    features: [
      "30 credits / month",
      "Gemini 3 Flash model",
      "Public projects only",
      "Community support",
      "Basic code editor",
      "Live preview",
    ],
    cta: "Start for free",
    priceId: "",
    free: true,
  },
  {
    name: "Pro",
    price: { monthly: "$20", annual: "$16" },
    period: "/month",
    icon: Crown,
    color: "border-primary",
    highlight: true,
    badge: "Most popular",
    description: "For builders shipping real products.",
    features: [
      "500 credits / month",
      "Claude Sonnet 4.6 + Gemini",
      "Private projects",
      "GitHub sync & push",
      "Deploy to Vercel",
      "Custom domains",
      "Priority support",
    ],
    cta: "Upgrade to Pro",
    priceId: import.meta.env.VITE_STRIPE_PRO_PRICE_ID || "price_pro",
    free: false,
  },
  {
    name: "Team",
    price: { monthly: "$60", annual: "$48" },
    period: "/month",
    icon: Building2,
    color: "border-border",
    highlight: false,
    badge: "",
    description: "For teams building together.",
    features: [
      "2,000 credits / month",
      "All Pro features",
      "5 team seats included",
      "Shared projects",
      "Analytics dashboard",
      "Dedicated support",
      "SSO (coming soon)",
    ],
    cta: "Upgrade to Team",
    priceId: import.meta.env.VITE_STRIPE_TEAM_PRICE_ID || "price_team",
    free: false,
  },
];

const faqs = [
  { q: "What is a credit?", a: "One credit = one AI message sent to the editor. Tool calls within a single message don't cost extra credits." },
  { q: "Do unused credits roll over?", a: "Credits reset monthly on your billing date. They don't roll over, but Pro users rarely hit the limit." },
  { q: "Can I cancel anytime?", a: "Yes — cancel anytime from your account settings. You keep access until the end of your billing period." },
  { q: "What models are available?", a: "Free tier uses Gemini 3 Flash. Pro and Team unlock Claude Sonnet 4.6 with automatic fallback between providers." },
  { q: "Is there a student discount?", a: "Yes! Email us with your .edu address for 50% off Pro." },
];

const Pricing = () => {
  const navigate = useNavigate();
  const [annual, setAnnual] = useState(false);

  const handleUpgrade = async (priceId: string, free: boolean) => {
    if (free) { navigate("/editor"); return; }
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
      if (!resp.ok) throw new Error("Checkout failed");
      const { url } = await resp.json();
      if (url) window.location.href = url;
    } catch {
      toast.error("Checkout unavailable. Configure STRIPE_SECRET_KEY and price IDs.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28 pb-24 px-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-2xl mx-auto mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/8 text-primary text-xs font-bold mb-6 border border-primary/18 tracking-widest uppercase">
            Pricing
          </span>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-4">
            Simple, honest pricing
          </h1>
          <p className="text-lg text-muted-foreground">
            Start free. Upgrade when you need more power.
          </p>

          {/* Annual toggle */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <span className={`text-sm font-medium ${!annual ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
            <button
              onClick={() => setAnnual(a => !a)}
              className={`relative w-11 h-6 rounded-full transition-colors ${annual ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${annual ? "left-6" : "left-1"}`} />
            </button>
            <span className={`text-sm font-medium ${annual ? "text-foreground" : "text-muted-foreground"}`}>
              Annual <span className="text-emerald-500 font-bold">−20%</span>
            </span>
          </div>
        </motion.div>

        {/* Plans */}
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {plans.map((plan, i) => {
            const Icon = plan.icon;
            return (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`relative rounded-2xl border-2 p-7 flex flex-col ${plan.color} ${plan.highlight ? "bg-primary/3 shadow-xl shadow-primary/10" : "bg-card"}`}
              >
                {plan.badge && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-wider shadow-sm">
                    {plan.badge}
                  </div>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${plan.highlight ? "bg-primary/15" : "bg-muted"}`}>
                    <Icon size={18} className={plan.highlight ? "text-primary" : "text-muted-foreground"} />
                  </div>
                  <div>
                    <div className="font-bold text-lg">{plan.name}</div>
                    <div className="text-xs text-muted-foreground">{plan.description}</div>
                  </div>
                </div>

                <div className="mb-6">
                  <span className="text-4xl font-black">
                    {annual ? plan.price.annual : plan.price.monthly}
                  </span>
                  <span className="text-muted-foreground text-sm">{plan.period}</span>
                </div>

                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check size={14} className="text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleUpgrade(plan.priceId, plan.free)}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                    plan.highlight
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25"
                      : plan.free
                      ? "bg-muted hover:bg-muted/80 text-foreground"
                      : "bg-foreground text-background hover:bg-foreground/90"
                  }`}
                >
                  {plan.cta} {!plan.free && <ArrowRight size={14} />}
                </button>
              </motion.div>
            );
          })}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently asked questions</h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className="border border-border rounded-xl p-5"
              >
                <div className="font-semibold text-sm mb-1.5">{faq.q}</div>
                <div className="text-sm text-muted-foreground">{faq.a}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;
