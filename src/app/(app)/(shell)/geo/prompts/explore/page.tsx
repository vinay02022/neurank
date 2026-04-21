import { Search } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Prompt Explorer" };

export default function Page() {
  return (
    <ComingSoon
      icon={Search}
      phase="Phase 04"
      title="Prompt Explorer"
      description="Discover high-intent prompts your customers are asking AI assistants."
    />
  );
}
