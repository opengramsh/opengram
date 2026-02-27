import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { GhostConversations } from "@/components/GhostConversations";
import { ProblemSection } from "@/components/ProblemSection";
import { ScreenshotPlaceholder } from "@/components/ScreenshotPlaceholder";
import { Features } from "@/components/Features";
import { InteractiveDemo } from "@/components/InteractiveDemo";
import { VideoPlaceholder } from "@/components/VideoPlaceholder";
import { HowItWorks } from "@/components/HowItWorks";
import { InstallSection } from "@/components/InstallSection";
import { Footer } from "@/components/Footer";
import { ThreadTimeline } from "@/components/ThreadTimeline";
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

          <div className="relative">
            <ThreadTimeline />

            <ProblemSection />
            <ScreenshotPlaceholder />
            <Features />

            <InteractiveDemo />

            <VideoPlaceholder />

            <HowItWorks />
            <InstallSection />
          </div>

          <Footer />
        </main>
      </div>

      <MobileInstallSheet />
    </>
  );
}
