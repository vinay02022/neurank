import { Target } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Content Optimizer" };

export default function Page() {
  return (
    <ComingSoon
      icon={Target}
      phase="Phase 05"
      title="Content Optimizer"
      description="Score a URL against target prompts and get actionable rewrite suggestions."
    />
  );
}
