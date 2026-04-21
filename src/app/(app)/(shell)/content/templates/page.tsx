import { LayoutGrid } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Templates" };

export default function Page() {
  return (
    <ComingSoon
      icon={LayoutGrid}
      phase="Phase 06"
      title="Templates"
      description="Starter templates for blog posts, landing pages, and product comparisons."
    />
  );
}
