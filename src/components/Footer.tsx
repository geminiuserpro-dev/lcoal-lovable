import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

const footerLinks = {
  Product: ["Features", "Templates", "Pricing", "Changelog", "Security"],
  Resources: ["Documentation", "Blog", "Community", "Support", "Status"],
  Company: ["About", "Careers", "Press", "Contact", "Legal"],
};

const Footer = () => (
  <footer className="relative bg-foreground dark:bg-card text-background dark:text-foreground py-24 overflow-hidden">
    {/* Noise texture */}
    <div className="absolute inset-0 opacity-[0.035]"
      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }}
    />
    {/* Gradient top edge */}
    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-current/20 to-transparent" />

    {/* Decorative orb */}
    <div className="absolute top-0 right-[20%] w-[500px] h-[300px] rounded-full blur-[120px] opacity-[0.06]"
      style={{ background: "linear-gradient(135deg, hsl(258 90% 62%), hsl(330 85% 58%))" }} />

    <div className="max-w-6xl mx-auto px-6 relative">
      <div className="grid md:grid-cols-4 gap-12 mb-20">
        <div>
          <div className="flex items-center gap-2.5 mb-6">
            <motion.div
              whileHover={{ rotate: 10, scale: 1.08 }}
              className="w-9 h-9 rounded-xl"
              style={{ background: "linear-gradient(135deg, hsl(258 90% 62%), hsl(330 85% 58%))" }}
            />
            <span className="text-xl font-black" style={{ fontFamily: "Syne, sans-serif" }}>Lovable</span>
          </div>
          <p className="opacity-45 text-sm leading-relaxed font-light">
            The AI-powered platform that turns your ideas into real software, instantly.
          </p>
          <motion.button
            whileHover={{ x: 4 }}
            className="mt-5 flex items-center gap-1.5 text-xs opacity-55 hover:opacity-90 transition-opacity font-medium"
          >
            Start building free <ArrowRight size={13} />
          </motion.button>
        </div>

        {Object.entries(footerLinks).map(([category, links]) => (
          <div key={category}>
            <h4 className="font-bold mb-6 text-[10px] uppercase tracking-[0.2em] opacity-30"
              style={{ fontFamily: "Syne, sans-serif" }}>
              {category}
            </h4>
            <ul className="space-y-3">
              {links.map(link => (
                <li key={link}>
                  <a href="#" className="text-sm opacity-50 hover:opacity-95 transition-opacity hover:translate-x-1 inline-block transition-transform">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-current/8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-sm opacity-30 font-light">© 2025 Lovable. All rights reserved.</span>
        <div className="flex items-center gap-6">
          {["Twitter", "GitHub", "Discord"].map(s => (
            <a key={s} href="#"
              className="text-xs opacity-35 hover:opacity-90 transition-opacity font-semibold tracking-wide">
              {s}
            </a>
          ))}
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
