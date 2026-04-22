import Link from "next/link";
import { Mic, Plus, Star, Calendar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { BrandVoiceRowActions } from "@/components/brand-voices/row-actions";
import { getCurrentMembership } from "@/lib/auth";
import { listBrandVoices } from "@/lib/article-queries";
import { planQuota } from "@/config/plans";

export const metadata = { title: "Brand Voices" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { workspace } = await getCurrentMembership();
  const voices = await listBrandVoices(workspace.id);
  const quota = planQuota(workspace.plan, "writingStyles");
  const quotaRemaining = Number.isFinite(quota) ? quota - voices.length : Infinity;
  const atLimit = quotaRemaining <= 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Brand Voices"
          description="Train a reusable style profile from sample writing, then apply it to every article you generate."
        />
        <Button asChild disabled={atLimit} variant="default">
          <Link href="/content/brand-voices/new">
            <Plus className="size-4" />
            New brand voice
          </Link>
        </Button>
      </div>

      {Number.isFinite(quota) ? (
        <p className="text-xs text-muted-foreground">
          {voices.length}/{quota} voices used on your plan.{" "}
          {atLimit ? (
            <Link href="/settings/billing" className="underline">
              Upgrade
            </Link>
          ) : null}
        </p>
      ) : null}

      {voices.length === 0 ? (
        <EmptyState
          icon={Mic}
          title="No brand voices yet"
          description="Your first voice takes ~30 seconds. Paste 300+ words of existing writing or drop in a few URLs you'd like to sound like."
          action={
            <Button asChild>
              <Link href="/content/brand-voices/new">Create your first voice</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {voices.map((v) => (
            <Card key={v.id} className="flex flex-col">
              <CardHeader className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{v.name}</CardTitle>
                  {v.isDefault ? (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="size-3" />
                      Default
                    </Badge>
                  ) : null}
                </div>
                <CardDescription className="line-clamp-2">
                  {v.description || "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="flex flex-wrap gap-1.5">
                  {v.toneTags.slice(0, 5).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] uppercase tracking-wide">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="justify-between border-t pt-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3" />
                  {formatDistanceToNow(v.updatedAt, { addSuffix: true })}
                </span>
                <BrandVoiceRowActions id={v.id} isDefault={v.isDefault} name={v.name} />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
