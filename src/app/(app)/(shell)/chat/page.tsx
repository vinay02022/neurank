import { MessagesSquare } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Chatsonic" };

export default function Page() {
  return (
    <ComingSoon
      icon={MessagesSquare}
      phase="Phase 07"
      title="Chatsonic"
      description="Multi-LLM chat with model picker, tool toggles, canvas and citations."
    />
  );
}
