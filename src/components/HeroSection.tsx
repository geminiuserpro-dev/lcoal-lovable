import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Mic, ArrowUp, ArrowRight, Sparkles, ShoppingBag, BarChart3, Calendar, Users, Palette, Zap, Folder, Clock, Loader2, Star } from "lucide-react";
import { useFirebase } from "./FirebaseProvider";
import { Project } from "@/types";

const templates = [
  { id: "t1", title: "SaaS Dashboard", description: "Analytics with real-time charts", gradient: "from-[hsl(258,75%,62%)] to-[hsl(200,85%,58%)]", icon: BarChart3 },
  { id: "t2", title: "E-commerce Store", description: "Full-featured online shop", gradient: "from-[hsl(330,82%,58%)] to-[hsl(270,75%,60%)]", icon: ShoppingBag },
  { id: "t3", title: "Portfolio Site", description: "Showcase your best work", gradient: "from-[hsl(20,88%,56%)] to-[hsl(38,92%,54%)]", icon: Palette },
  { id: "t4", title: "Event Booking", description: "Calendar & scheduling", gradient: "from-[hsl(155,62%,42%)] to-[hsl(180,68%,42%)]", icon: Calendar },
  { id: "t5", title: "Team Collaboration", description: "Project management", gradient: "from-[hsl(258,85%,62%)] to-[hsl(278,78%,65%)]", icon: Users },
  { id: "t6", title: "AI Chat App", description: "Conversational interface", gradient: "from-[hsl(330,85%,58%)] to-[hsl(20,88%,56%)]", icon: Sparkles },
];

const placeholders = [
  "Build a SaaS dashboard with auth and analytics...",
  "Create a portfolio site with smooth animations...",
  "Design an e-commerce store with cart and checkout...",
  "Make a real-time chat app with AI responses...",
];

const HeroSection = () => {
  const [inputValue, setInputValue] = useState("");
  const [activeTab, setActiveTab] = useState("templates");
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const { user } = useFirebase();
  const navigate = useNavigate();

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx(i => (i + 1) % placeholders.length), 3800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (activeTab === "projects" && user) {
      setIsLoadingProjects(true);
      import("@/services/ProjectService").then(({ ProjectService }) =>
        ProjectService.getProjects().then(setProjects).catch(console.error).finally(() => setIsLoadingProjects(false))
      );
    }
  }, [activeTab, user]);

  const handleSubmit = () => { if (inputValue.trim()) navigate("/editor"); };
  const displayItems = activeTab === "projects" ? projects : templates;

  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden pt-16">
      <div className="absolute inset-0 hero-gradient" />
      <div className="absolute inset-0 bg-mesh opacity-70" />

      <div className="absolute top-12 left-[8%] w-[420px] h-[420px] rounded-full blur-[100px] animate-blob"
        style={{ background: "hsl(258 80% 70% / 0.28)" }} />
      <div className="absolute top-28 right-[10%] w-[500px] h-[500px] rounded-full blur-[120px] animate-blob animation-delay-2000"
        style={{ background: "hsl(330 80% 65% / 0.22)" }} />
      <div className="absolute bottom-24 left-[28%] w-[380px] h-[380px] rounded-full blur-[90px] animate-blob animation-delay-4000"
        style={{ background: "hsl(200 85% 65% / 0.2)" }} />
      <div className="absolute top-[55%] right-[4%] w-[280px] h-[280px] rounded-full blur-[70px] animate-blob animation-delay-6000"
        style={{ background: "hsl(20 88% 65% / 0.18)" }} />

      <div className="absolute inset-0 noise-overlay pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-background via-background/85 to-transparent" />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pt-10 pb-6">
        <div className="w-full max-w-3xl mx-auto text-center">

          <motion.div
            initial={{ opacity: 0, y: -24, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex items-center gap-2 mb-12 glass-button rounded-full px-1.5 py-1.5 pr-5"
          >
            <span className="px-3 py-1 rounded-full bg-gradient-vivid text-white text-xs font-bold shadow-lg flex items-center gap-1.5">
              <Zap size={11} className="fill-current" />
              New
            </span>
            <span className="text-sm text-foreground/80 font-medium flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors">
              Gemini 3 Flash is now powering your editor
              <ArrowRight size={13} className="opacity-50" />
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 36, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="text-6xl sm:text-7xl md:text-[5.5rem] font-bold tracking-tight text-foreground mb-6 leading-[1.04]"
          >
            What should{" "}
            <br className="hidden sm:block" />
            we{" "}
            <span className="text-gradient-vivid">build</span>?
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="text-xl text-muted-foreground mb-12 max-w-md mx-auto leading-relaxed font-light"
          >
            Describe your idea and watch it come to life — powered by AI, deployed in seconds.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.85, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass-input rounded-[1.85rem] overflow-hidden max-w-2xl mx-auto"
          >
            <AnimatePresence mode="wait">
              <textarea
                key={placeholderIdx}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder={placeholders[placeholderIdx]}
                className="w-full bg-transparent border-none outline-none resize-none text-base text-foreground placeholder:text-muted-foreground/50 p-5 pb-3 min-h-[68px] max-h-[130px] font-normal"
                rows={2}
              />
            </AnimatePresence>
            <div className="flex items-center justify-between px-4 pb-4">
              <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                className="p-2.5 rounded-xl hover:bg-foreground/6 transition-all text-muted-foreground hover:text-foreground">
                <Plus size={20} />
              </motion.button>
              <div className="flex items-center gap-2">
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                  className="p-2.5 rounded-xl hover:bg-foreground/6 transition-all text-muted-foreground hover:text-foreground">
                  <Mic size={18} />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.07 }}
                  whileTap={{ scale: 0.93 }}
                  onClick={handleSubmit}
                  className="w-11 h-11 rounded-2xl bg-gradient-vivid text-white flex items-center justify-center shadow-lg transition-all"
                  style={{ boxShadow: "0 0 28px -4px hsl(258 90% 62% / 0.5), 0 0 60px -12px hsl(330 85% 58% / 0.3)" }}
                >
                  <ArrowUp size={18} />
                </motion.button>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            className="flex items-center justify-center gap-6 mt-8 text-sm text-muted-foreground/80"
          >
            {["5M+ apps built", "30K+ daily builders", "No credit card needed"].map((t, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <Star size={11} className="fill-amber-400 text-amber-400" />
                {t}
              </span>
            ))}
          </motion.div>
        </div>
      </div>

      <div className="relative z-10 w-full glass-panel rounded-t-[2.5rem] pt-9 pb-16">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex items-center justify-between mb-9"
          >
            <div className="flex items-center gap-1.5 p-1.5 glass-button rounded-full">
              {[{ id: "recent", label: "Recent" }, { id: "projects", label: "My projects" }, { id: "templates", label: "Templates" }].map(({ id, label }) => (
                <TabButton key={id} label={label} active={activeTab === id} onClick={() => setActiveTab(id)} />
              ))}
            </div>
            <motion.button whileHover={{ x: 4 }}
              className="hidden md:flex items-center gap-1.5 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
              Browse all <ArrowRight size={14} />
            </motion.button>
          </motion.div>

          {isLoadingProjects ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 size={32} className="animate-spin mb-4 text-primary" />
              <p className="font-medium">Loading your projects...</p>
            </div>
          ) : activeTab === "projects" && projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl">
              <Folder size={48} className="mb-4 opacity-20" />
              <p className="text-lg font-semibold">No projects yet</p>
              <p className="text-sm mt-1 opacity-70">Start building something amazing!</p>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.45 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayItems.map((item, index) =>
                activeTab === "projects"
                  ? <ProjectCard key={item.id} project={item as Project} index={index} />
                  : <TemplateCard key={item.id} template={item as any} index={index} />
              )}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
};

const TabButton = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <motion.button whileHover={{ scale: active ? 1 : 1.04 }} whileTap={{ scale: 0.96 }} onClick={onClick}
    className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
      active ? "bg-foreground text-background shadow-md" : "text-foreground/60 hover:text-foreground hover:bg-foreground/6"
    }`}>
    {label}
  </motion.button>
);

const ProjectCard = ({ project, index }: { project: Project; index: number }) => {
  const navigate = useNavigate();
  const lastModified = project.lastModified?.toDate?.() || new Date(project.lastModified);
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.07 * index, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => navigate(`/editor?project=${project.id}`)}
      className="group glass-card rounded-2xl overflow-hidden cursor-pointer">
      <div className="h-32 bg-gradient-to-br from-muted to-background relative overflow-hidden flex items-center justify-center">
        <Folder size={44} className="text-muted-foreground/25 group-hover:scale-110 transition-transform duration-500" />
        <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-background/60 backdrop-blur text-[10px] font-mono text-muted-foreground border border-border/40">
          #{project.id.slice(0, 6)}
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">{project.name}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
          <Clock size={11} /><span>Modified {lastModified.toLocaleDateString()}</span>
        </div>
      </div>
    </motion.div>
  );
};

const TemplateCard = ({ template, index }: { template: typeof templates[0]; index: number }) => {
  const navigate = useNavigate();
  const Icon = template.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.07 * index, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => navigate("/editor")}
      className="group glass-card rounded-2xl overflow-hidden cursor-pointer">
      <div className={`h-32 bg-gradient-to-br ${template.gradient} relative overflow-hidden`}>
        <div className="absolute inset-0 bg-white/8 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/10" />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div whileHover={{ scale: 1.18, rotate: 8 }} transition={{ type: "spring", stiffness: 320 }}>
            <Icon size={42} className="text-white drop-shadow-lg" />
          </motion.div>
        </div>
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
      </div>
      <div className="p-5">
        <h3 className="font-semibold text-foreground mb-1.5 group-hover:text-primary transition-colors">{template.title}</h3>
        <p className="text-sm text-muted-foreground/75 leading-relaxed">{template.description}</p>
      </div>
    </motion.div>
  );
};

export default HeroSection;
