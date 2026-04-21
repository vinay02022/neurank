import { KeyRound } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "API Keys" };

export default function Page() {
  return (
    <ComingSoon
      icon={KeyRound}
      phase="Phase 09"
      title="API Keys"
      description="Issue and rotate API keys for the Neurank public API."
    />
  );
}
