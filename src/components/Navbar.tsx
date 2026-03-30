import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X, ChevronDown, LogOut, User as UserIcon, Sparkles, FolderOpen, Settings } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useFirebase } from "./FirebaseProvider";
import { ProfileModal } from "./ProfileModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const navigate = useNavigate();
  const { user, profile, signInWithGoogle, logout } = useFirebase();

  const handleUpgrade = async () => {
    try {
      setIsUpgrading(true);
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: 'price_1Qx234567890', // Replace with actual Stripe price ID
          successUrl: `${window.location.origin}/?success=true`,
          cancelUrl: `${window.location.origin}/?canceled=true`,
        }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      alert('Failed to initiate checkout. Please try again.');
    } finally {
      setIsUpgrading(false);
    }
  };

  return (
    <motion.nav
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <div className="mx-4 mt-3">
        <div className="glass-panel rounded-2xl px-5 h-14 flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-8">
            <a href="/" className="flex items-center gap-2.5 group">
              <motion.div
                whileHover={{ rotate: 8, scale: 1.05 }}
                className="w-8 h-8 rounded-xl shadow-lg" style={{ background: "var(--gradient-vivid)", boxShadow: "0 0 16px -4px hsl(258 90% 62% / 0.45)" }}
              />
              <span className="text-lg font-black text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>Lovable</span>
            </a>
            <div className="hidden md:flex items-center gap-0.5">
              <NavItem label="Solutions" hasDropdown />
              <NavItem label="Resources" hasDropdown />
              <NavItem label="Enterprise" />
              <NavItem label="Pricing" />
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {!user ? (
              <>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-foreground/75 hover:text-foreground rounded-xl font-medium"
                  onClick={signInWithGoogle}
                >
                  Log in
                </Button>
                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                  <Button
                    size="sm"
                    className="text-white hover:opacity-90 rounded-xl px-5 shadow-lg font-bold border-0" style={{ background: "var(--gradient-vivid)", boxShadow: "0 0 18px -4px hsl(258 90% 62% / 0.45)" }}
                    onClick={() => navigate("/editor")}
                  >
                    Get started
                  </Button>
                </motion.div>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl font-medium border-primary/20 hover:bg-primary/5 text-primary gap-1.5 mr-2"
                  onClick={handleUpgrade}
                  disabled={isUpgrading}
                >
                  <Sparkles size={14} className={isUpgrading ? "animate-spin" : ""} />
                  {isUpgrading ? "Loading..." : "Upgrade to Pro"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                      <Avatar className="h-10 w-10">
                        <AvatarImage 
                          src={profile?.photoURL || user.photoURL || ""} 
                          alt={profile?.displayName || user.displayName || ""} 
                          referrerPolicy="no-referrer"
                        />
                        <AvatarFallback>{(profile?.displayName || user.displayName)?.charAt(0) || user.email?.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{profile?.displayName || user.displayName}</p>
                        <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Profile Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/editor")}>
                      <UserIcon className="mr-2 h-4 w-4" />
                      <span>Editor</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/projects")}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      <span>Projects</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
          <button
            className="md:hidden text-foreground p-2 rounded-xl hover:bg-foreground/5 transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            className="md:hidden mx-4 mt-2"
          >
            <div className="glass-panel rounded-2xl px-6 py-4 space-y-2">
              {["Solutions", "Resources", "Enterprise", "Pricing"].map(item => (
                <a key={item} href="#" className="block py-2.5 text-foreground/80 hover:text-foreground transition-colors font-medium">
                  {item}
                </a>
              ))}
              <div className="flex gap-2 pt-3 border-t border-border/30">
                {!user ? (
                  <>
                    <Button variant="ghost" size="sm" className="flex-1 rounded-xl" onClick={signInWithGoogle}>Log in</Button>
                    <Button size="sm" className="flex-1 rounded-xl bg-gradient-primary text-white border-0" onClick={() => navigate("/editor")}>
                      Get started
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col gap-2 w-full">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full rounded-xl border-primary/20 text-primary" 
                      onClick={handleUpgrade}
                      disabled={isUpgrading}
                    >
                      <Sparkles size={14} className="mr-2" />
                      Upgrade to Pro
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full rounded-xl" onClick={() => setIsProfileOpen(true)}>Profile Settings</Button>
                    <Button variant="ghost" size="sm" className="w-full rounded-xl" onClick={logout}>Log out</Button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </motion.nav>
  );
};

const NavItem = ({ label, hasDropdown }: { label: string; hasDropdown?: boolean }) => (
  <a
    href="#"
    className="flex items-center gap-1 px-3.5 py-2 text-sm text-foreground/65 hover:text-foreground transition-colors rounded-xl hover:bg-foreground/5 font-medium"
  >
    {label}
    {hasDropdown && <ChevronDown size={14} className="opacity-40" />}
  </a>
);

export default Navbar;
