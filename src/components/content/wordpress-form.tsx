"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  removeWordpressCredentialAction,
  saveWordpressCredentialAction,
} from "@/server/actions/wordpress";

interface Props {
  initial: { siteUrl: string; username: string; connectedAt: Date } | null;
}

export function WordpressForm({ initial }: Props) {
  const router = useRouter();
  const [siteUrl, setSiteUrl] = React.useState(initial?.siteUrl ?? "");
  const [username, setUsername] = React.useState(initial?.username ?? "");
  const [appPassword, setAppPassword] = React.useState("");
  const [busy, setBusy] = React.useState<null | "save" | "remove">(null);

  const onSave = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!appPassword && initial) {
        toast.error(
          "To update the credential, enter a new Application Password. Leave other fields unchanged to only rotate the password.",
        );
        return;
      }
      setBusy("save");
      const res = await saveWordpressCredentialAction({
        siteUrl: siteUrl.trim(),
        username: username.trim(),
        appPassword: appPassword.trim(),
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAppPassword("");
      toast.success("WordPress connected");
      router.refresh();
    },
    [siteUrl, username, appPassword, initial, router],
  );

  const onRemove = React.useCallback(async () => {
    if (!window.confirm("Remove the WordPress credential?")) return;
    setBusy("remove");
    const res = await removeWordpressCredentialAction();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSiteUrl("");
    setUsername("");
    setAppPassword("");
    toast.success("WordPress disconnected");
    router.refresh();
  }, [router]);

  return (
    <form onSubmit={onSave} className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="wp-url">Site URL</Label>
        <Input
          id="wp-url"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          placeholder="https://example.com"
          required
          disabled={busy !== null}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wp-user">Username</Label>
        <Input
          id="wp-user"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="wp-admin"
          required
          disabled={busy !== null}
        />
      </div>
      <div className="md:col-span-2 space-y-1.5">
        <Label htmlFor="wp-pw">Application Password</Label>
        <Input
          id="wp-pw"
          type="password"
          value={appPassword}
          onChange={(e) => setAppPassword(e.target.value)}
          placeholder={initial ? "•••• •••• (leave blank to keep current)" : "xxxx xxxx xxxx xxxx"}
          autoComplete="new-password"
          disabled={busy !== null}
        />
        <p className="text-[11px] text-muted-foreground">
          Create one under <em>Users → Your profile → Application Passwords</em> in WordPress
          admin.
        </p>
      </div>

      <div className="md:col-span-2 flex items-center justify-end gap-2">
        {initial ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onRemove}
            disabled={busy !== null}
            className="gap-1 text-red-500 hover:text-red-600"
          >
            {busy === "remove" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Disconnect
          </Button>
        ) : null}
        <Button type="submit" disabled={busy !== null} className="gap-1.5">
          {busy === "save" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {initial ? "Update" : "Connect"}
        </Button>
      </div>
    </form>
  );
}
