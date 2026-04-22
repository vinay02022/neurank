import { Plug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { WordpressForm } from "@/components/content/wordpress-form";
import { getCurrentMembership } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { workspace } = await getCurrentMembership();
  const cred = await db.wordPressCredential.findUnique({
    where: { workspaceId: workspace.id },
    select: { siteUrl: true, username: true, updatedAt: true },
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description="Destinations and data sources connected to this workspace."
      />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plug className="size-4 text-primary" />
              <CardTitle className="text-base">WordPress</CardTitle>
            </div>
            {cred ? (
              <Badge variant="secondary" className="text-[10px]">
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Not connected
              </Badge>
            )}
          </div>
          <CardDescription>
            Publish generated articles directly to your WordPress site using an Application
            Password. We encrypt the password at rest with AES-256-GCM.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WordpressForm
            initial={
              cred
                ? { siteUrl: cred.siteUrl, username: cred.username, connectedAt: cred.updatedAt }
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
