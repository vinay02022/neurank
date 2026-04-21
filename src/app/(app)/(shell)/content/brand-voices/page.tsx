import { Mic } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Brand Voices" };

export default function Page() {
  return (
    <ComingSoon
      icon={Mic}
      phase="Phase 06"
      title="Brand Voices"
      description="Train reusable voices from sample writing and apply them to every article."
    />
  );
}
