import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect, useRef } from "react";

const stats = [
  { value: "5M+", label: "Projects built on Lovable", color: "from-[hsl(258,90%,62%)] to-[hsl(280,85%,65%)]", glow: "hsl(258 90% 62% / 0.4)" },
  { value: "30K+", label: "Projects shipped every day", color: "from-[hsl(330,85%,58%)] to-[hsl(258,90%,62%)]", glow: "hsl(330 85% 58% / 0.4)" },
  { value: "10M", label: "Daily visits to Lovable apps", color: "from-[hsl(200,88%,55%)] to-[hsl(258,90%,62%)]", glow: "hsl(200 88% 55% / 0.4)" },
];

const StatsSection = () => (
  <section className="py-36 bg-background relative overflow-hidden">
    <div className="absolute inset-0 bg-mesh opacity-25" />

    {/* Large decorative number */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
      <div className="text-[32rem] font-black text-foreground/[0.015] leading-none"
        style={{ fontFamily: "Syne, sans-serif" }}>∞</div>
    </div>

    <div className="max-w-5xl mx-auto px-6 text-center relative">
      <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-20">
        <span className="inline-block px-4 py-1.5 rounded-full bg-accent/8 text-accent text-xs font-bold mb-7 border border-accent/18 tracking-widest uppercase">
          By the numbers
        </span>
        <h2 className="text-5xl md:text-6xl font-bold text-foreground leading-[1.05] mb-4">
          Lovable in <span className="text-gradient">numbers</span>
        </h2>
        <p className="text-muted-foreground text-lg max-w-md mx-auto font-light">
          Millions of builders are already turning ideas into reality
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.88, y: 20 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="glass-card rounded-2xl p-10 relative overflow-hidden group"
          >
            {/* Gradient glow backdrop */}
            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-gradient-to-br ${stat.color}`}
              style={{ opacity: 0.04 }} />

            <div className={`text-5xl md:text-6xl font-black bg-gradient-to-br ${stat.color} bg-clip-text text-transparent mb-4 leading-none`}
              style={{ WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {stat.value}
            </div>
            <p className="text-muted-foreground/80 text-sm font-medium leading-relaxed">{stat.label}</p>

            {/* Bottom highlight bar */}
            <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-1/3 h-0.5 rounded-full bg-gradient-to-r ${stat.color} opacity-60`} />
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default StatsSection;
