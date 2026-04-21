import { Radar } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Brand Visibility" };

export default function Page() {
  return (
    <ComingSoon
      icon={Radar}
      phase="Phase 03"
      title="Brand Visibility"
      description="Prompt-level table of AI answers with drill-down into citations and sentiment."
    />
  );
}
