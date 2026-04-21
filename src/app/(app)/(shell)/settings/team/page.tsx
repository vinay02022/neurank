import { Users } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Team" };

export default function Page() {
  return (
    <ComingSoon
      icon={Users}
      phase="Phase 09"
      title="Team"
      description="Invite teammates, set roles, and manage seats per workspace."
    />
  );
}
