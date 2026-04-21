import { KeyRound } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Keywords" };

export default function Page() {
  return (
    <ComingSoon
      icon={KeyRound}
      phase="Phase 05"
      title="Keywords"
      description="Traditional search keyword tracking — volume, difficulty, and ranking trend."
    />
  );
}
