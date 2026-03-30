import { motion } from "motion/react";
import { Lightbulb, Play, Rocket } from "lucide-react";

const steps = [
  {
    icon: Lightbulb,
    title: "Start with an idea",
    description: "Describe the app you want to build, or drop in screenshots and docs for inspiration.",
    color: "from-[hsl(38,92%,54%)] to-[hsl(20,88%,56%)]",
    glow: "hsl(38 92% 54% / 0.35)",
    num: "01",
  },
  {
    icon: Play,
    title: "Watch it come to life",
    description: "See your vision transform into a working prototype in real-time as AI writes the code.",
    color: "from-[hsl(258,90%,62%)] to-[hsl(200,85%,56%)]",
    glow: "hsl(258 90% 62% / 0.35)",
    num: "02",
  },
  {
    icon: Rocket,
    title: "Refine and ship",
    description: "Iterate naturally with plain English — then deploy to the world with a single click.",
    color: "from-[hsl(330,85%,58%)] to-[hsl(278,78%,60%)]",
    glow: "hsl(330 85% 58% / 0.35)",
    num: "03",
  },
];

const HowItWorks = () => (
  <section className="py-36 bg-background relative overflow-hidden">
    <div className="absolute inset-0 bg-mesh opacity-40" />
    {/* Diagonal accent line */}
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute top-1/3 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
    </div>

    <div className="max-w-6xl mx-auto px-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center mb-24"
      >
        <span className="inline-block px-4 py-1.5 rounded-full bg-primary/8 text-primary text-xs font-bold mb-7 border border-primary/18 tracking-widest uppercase">
          How it works
        </span>
        <h2 className="text-5xl md:text-6xl font-bold text-foreground leading-[1.05]">
          Meet <span className="text-gradient-vivid">Lovable</span>
        </h2>
        <p className="text-muted-foreground text-lg mt-4 max-w-md mx-auto font-light">
          From idea to shipped product — three steps is all it takes.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6 relative">
        {/* Connector line */}
        <div className="hidden md:block absolute top-16 left-[calc(16.66%+2rem)] right-[calc(16.66%+2rem)] h-px bg-gradient-to-r from-transparent via-border/70 to-transparent" />

        {steps.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 36 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.14, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="group relative"
          >
            <div className="glass-card rounded-2xl p-8 text-center h-full relative overflow-hidden">
              {/* Step number watermark */}
              <div className="absolute top-4 right-5 text-6xl font-black text-foreground/4 select-none leading-none"
                style={{ fontFamily: "Syne, sans-serif" }}>
                {step.num}
              </div>

              <motion.div
                whileHover={{ scale: 1.12, y: -4 }}
                transition={{ type: "spring", stiffness: 280 }}
                className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center mx-auto mb-6 shadow-xl`}
                style={{ boxShadow: `0 0 28px -6px ${step.glow}` }}
              >
                <step.icon size={26} className="text-white" />
              </motion.div>

              <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-[0.2em]">Step {i + 1}</span>
              <h3 className="text-xl font-bold text-foreground mt-2 mb-3 leading-tight">{step.title}</h3>
              <p className="text-muted-foreground/80 leading-relaxed text-sm font-light">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorks;
