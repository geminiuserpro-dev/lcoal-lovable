import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

const templates = [
  { title: "Personal portfolio", desc: "Clean work showcase", color: "from-[hsl(20,88%,56%)] to-[hsl(38,92%,54%)]", badge: "Popular" },
  { title: "Presentation builder", desc: "Code-powered slides", color: "from-[hsl(200,88%,54%)] to-[hsl(258,90%,62%)]", badge: "" },
  { title: "Fashion blog", desc: "Minimal, playful design", color: "from-[hsl(330,85%,58%)] to-[hsl(278,78%,60%)]", badge: "Trending" },
  { title: "Event platform", desc: "Find & register for events", color: "from-[hsl(155,62%,42%)] to-[hsl(180,68%,44%)]", badge: "" },
  { title: "Ecommerce store", desc: "Premium webstore design", color: "from-[hsl(258,90%,62%)] to-[hsl(278,78%,65%)]", badge: "New" },
  { title: "Architect portfolio", desc: "Firm website & showcase", color: "from-[hsl(225,18%,48%)] to-[hsl(225,20%,36%)]", badge: "" },
];

const TemplatesSection = () => (
  <section className="py-36 relative overflow-hidden">
    <div className="absolute inset-0 bg-secondary/30" />
    <div className="absolute inset-0 bg-mesh opacity-20" />

    <div className="max-w-6xl mx-auto px-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="flex items-end justify-between mb-14"
      >
        <div>
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/8 text-primary text-xs font-bold mb-7 border border-primary/18 tracking-widest uppercase">
            Templates
          </span>
          <h2 className="text-5xl md:text-6xl font-bold text-foreground leading-[1.05]">
            Discover <span className="text-gradient-primary">templates</span>
          </h2>
          <p className="text-muted-foreground text-lg mt-3 font-light">Start your next project with a proven foundation</p>
        </div>
        <motion.button
          whileHover={{ x: 5 }}
          className="hidden md:flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors font-semibold"
        >
          View all <ArrowRight size={15} />
        </motion.button>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {templates.map((t, i) => (
          <motion.div
            key={t.title}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="group cursor-pointer glass-card rounded-2xl overflow-hidden"
          >
            <div className={`aspect-video bg-gradient-to-br ${t.color} relative overflow-hidden`}>
              {/* Layered shine effects */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/22 via-transparent to-black/12" />
              <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-white/15 to-transparent" />
              {/* Grid texture */}
              <div className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage: "linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)",
                  backgroundSize: "28px 28px"
                }} />
              {t.badge && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white text-[10px] font-bold border border-white/25">
                  {t.badge}
                </div>
              )}
            </div>
            <div className="p-5">
              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors leading-tight mb-1">{t.title}</h3>
              <p className="text-sm text-muted-foreground/70 font-light">{t.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default TemplatesSection;
