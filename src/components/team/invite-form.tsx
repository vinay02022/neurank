"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, MailPlus, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inviteMemberAction } from "@/server/actions/team";

interface Props {
  disabled: boolean;
  remainingSeats: number | null;
}

/**
 * Invite-by-email form. Calls inviteMemberAction; on success we
 * surface the raw invite URL inline with a "Copy link" button so the
 * admin can share it directly when email isn't configured (or just
 * wants to ping a colleague in Slack faster than an email round-trip).
 */
export function InviteForm({ disabled, remainingSeats }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    email: string;
    url: string;
    delivered: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCopied(false);
    start(async () => {
      const res = await inviteMemberAction({ email, role });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess({ email, url: res.data.url, delivered: res.data.delivered });
      setEmail("");
      router.refresh();
    });
  }

  async function copyUrl() {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail on insecure contexts. Fall back to a
      // user-driven select-and-copy by leaving the URL visible.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Invite teammate</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
          <div className="space-y-1">
            <Label htmlFor="invite-email" className="text-xs">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              required
              autoComplete="off"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled || pending}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "ADMIN" | "MEMBER")}
              disabled={disabled || pending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={disabled || pending} className="w-full sm:w-auto">
              {pending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <MailPlus className="mr-2 size-4" />
              )}
              Send invite
            </Button>
          </div>
        </form>

        {disabled && (
          <p className="mt-3 text-xs text-amber-600">
            Seat cap reached — upgrade your plan to invite more.
          </p>
        )}
        {!disabled && remainingSeats !== null && remainingSeats <= 2 && remainingSeats > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {remainingSeats} seat{remainingSeats === 1 ? "" : "s"} remaining on this plan.
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {success && (
          <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">
              {success.delivered
                ? `Invite sent to ${success.email}.`
                : `Invite created for ${success.email}.`}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {success.delivered
                ? "They'll receive an email shortly. You can also share this link directly:"
                : "Email isn't configured, so share this link directly:"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input readOnly value={success.url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant="outline" onClick={copyUrl} type="button">
                {copied ? (
                  <>
                    <Check className="mr-1 size-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 size-3" /> Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
