import { Plug } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Integrations" };

export default function Page() {
  return (
    <ComingSoon
      icon={Plug}
      phase="Phase 09"
      title="Integrations"
      description="Connect Search Console, Analytics, Zapier and CMS destinations."
    />
  );
}
