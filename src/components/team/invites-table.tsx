"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, X, Send, Check, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resendInviteAction, revokeInviteAction } from "@/server/actions/team";
import type { InviteRow } from "@/lib/team-queries";

interface Props {
  invites: InviteRow[];
}

/**
 * Pending invites table. We surface revoke (destructive, immediate)
 * and resend (rotates the token + ships a fresh email; URL is also
 * surfaced inline for the copy-link flow when email isn't configured).
 */
export function InvitesTable({ invites }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recentLink, setRecentLink] = useState<{ inviteId: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function revoke(id: string) {
    setError(null);
    setBusyId(id);
    start(async () => {
      try {
        const res = await revokeInviteAction({ inviteId: id });
        if (!res.ok) setError(res.error);
        else router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  function resend(id: string) {
    setError(null);
    setBusyId(id);
    start(async () => {
      try {
        const res = await resendInviteAction({ inviteId: id });
        if (!res.ok) {
          setError(res.error);
        } else {
          setRecentLink({ inviteId: id, url: res.data.url });
          router.refresh();
        }
      } finally {
        setBusyId(null);
      }
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failure (insecure context); user can still
      // select-and-copy the URL field manually
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Pending invites</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-[60px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="text-sm">
                  {inv.email}
                  {recentLink?.inviteId === inv.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        readOnly
                        value={recentLink.url}
                        className="w-full max-w-md rounded border bg-muted/40 px-2 py-1 font-mono text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button size="sm" variant="outline" onClick={() => copy(recentLink.url)}>
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
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{inv.role}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {inv.expiresAt.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={pending && busyId === inv.id}
                      >
                        {pending && busyId === inv.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <MoreHorizontal className="size-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => resend(inv.id)}>
                        <Send className="mr-2 size-3" /> Resend
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => revoke(inv.id)}
                      >
                        <X className="mr-2 size-3" /> Revoke
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
