import { ShoppingBag } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "ChatGPT Shopping" };

export default function Page() {
  return (
    <ComingSoon
      icon={ShoppingBag}
      phase="Phase 03"
      title="ChatGPT Shopping"
      description="Track product visibility and pricing signals inside ChatGPT shopping answers."
    />
  );
}
