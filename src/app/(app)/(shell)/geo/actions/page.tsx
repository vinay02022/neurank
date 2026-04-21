import { ListChecks } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Action Center" };

export default function Page() {
  return (
    <ComingSoon
      icon={ListChecks}
      phase="Phase 04"
      title="Action Center"
      description="Your queue of content, citation, technical and social tasks, scored by impact."
    />
  );
}
