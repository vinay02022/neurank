import { ShieldCheck } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Site Audit" };

export default function Page() {
  return (
    <ComingSoon
      icon={ShieldCheck}
      phase="Phase 05"
      title="Site Audit"
      description="Crawl your site, score it 0–100, and fix the issues that move AI answers."
    />
  );
}
