import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { BrandVoiceForm } from "@/components/brand-voices/brand-voice-form";

export const metadata = { title: "New Brand Voice" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 h-8 gap-1.5">
          <Link href="/content/brand-voices">
            <ArrowLeft className="size-3.5" />
            Back to brand voices
          </Link>
        </Button>
        <SectionHeader
          title="Create a brand voice"
          description="Paste 300+ words of existing writing, optionally add a few URLs, and we'll distil a reusable style profile."
        />
      </div>
      <BrandVoiceForm />
    </div>
  );
}
