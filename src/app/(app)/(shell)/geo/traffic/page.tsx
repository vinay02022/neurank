import { Activity } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "AI Traffic" };

export default function Page() {
  return (
    <ComingSoon
      icon={Activity}
      phase="Phase 04"
      title="AI Traffic"
      description="Attribute sessions and conversions back to the AI engines that drove them."
    />
  );
}
