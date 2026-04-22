import { SectionHeader } from "@/components/ui/section-header";
import { OptimizerForm } from "@/components/seo/optimizer-form";
import { getCurrentMembership } from "@/lib/auth";

export const metadata = { title: "Content Optimizer" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // Resolve membership so the RSC is workspace-scoped for rate
  // limiting; the client-side form handles its own submission.
  await getCurrentMembership();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Content Optimizer"
        description="Paste a URL to run the same GEO + SEO checks as the full site audit, focused on a single page."
      />
      <OptimizerForm />
    </div>
  );
}
