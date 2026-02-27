import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { GhostConversations } from "@/components/GhostConversations";
import { ProblemSection } from "@/components/ProblemSection";
import { Features } from "@/components/Features";
import { OpenClawSection } from "@/components/OpenClawSection";
import { InteractiveDemo } from "@/components/InteractiveDemo";
import { HowItWorks } from "@/components/HowItWorks";
import { InstallSection } from "@/components/InstallSection";
import { Footer } from "@/components/Footer";
import { MobileInstallSheet } from "@/components/MobileInstallSheet";

export default function Home() {
  return (
    <>
      <div className="relative z-10">
        <Nav />

        <main>
          {/* Hero with ghost conversations background */}
          <div className="relative overflow-hidden">
            <GhostConversations />
            <Hero />
          </div>

          <ProblemSection />
          <Features />
          <OpenClawSection />

          <InteractiveDemo />

          <HowItWorks />
          <InstallSection />

          <Footer />
        </main>
      </div>

      <MobileInstallSheet />
    </>
  );
}
