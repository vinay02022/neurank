import { Image as ImageIcon } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Photosonic" };

export default function Page() {
  return (
    <ComingSoon
      icon={ImageIcon}
      phase="Phase 07"
      title="Photosonic"
      description="Image generation with brand-safe styles and royalty-free output."
    />
  );
}
