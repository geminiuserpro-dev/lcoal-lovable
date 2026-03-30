import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import HowItWorks from "@/components/HowItWorks";
import TemplatesSection from "@/components/TemplatesSection";
import StatsSection from "@/components/StatsSection";
import Footer from "@/components/Footer";
import OnboardingModal from "@/components/OnboardingModal";
import UpgradeModal from "@/components/UpgradeModal";
import { toast } from "sonner";
import { useFirebase } from "@/components/FirebaseProvider";

const Index = () => {
  const { user } = useFirebase();
  const [searchParams] = useSearchParams();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    // Show onboarding for first-time users
    if (user && !localStorage.getItem("onboarding_complete")) {
      setTimeout(() => setShowOnboarding(true), 800);
    }
    // Show upgrade success toast
    if (searchParams.get("upgraded") === "true") {
      toast.success("🎉 Welcome to Pro! Your credits have been upgraded.");
    }
  }, [user, searchParams]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <HowItWorks />
      <TemplatesSection />
      <StatsSection />
      <Footer />
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />
      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </div>
  );
};

export default Index;
