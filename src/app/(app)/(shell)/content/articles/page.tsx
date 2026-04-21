import { FileText } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Articles" };

export default function Page() {
  return (
    <ComingSoon
      icon={FileText}
      phase="Phase 06"
      title="Articles"
      description="Instant, 4-step and 10-step AI article writers with brand voice + live preview."
    />
  );
}
