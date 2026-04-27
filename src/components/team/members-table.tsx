"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, MoreHorizontal, Shield, User as UserIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  changeRoleAction,
  removeMemberAction,
  transferOwnershipAction,
} from "@/server/actions/team";
import type { MemberRow } from "@/lib/team-queries";
import type { Role } from "@prisma/client";

interface Props {
  members: MemberRow[];
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
}

const ROLE_POWER: Record<Role, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

/**
 * Sortable list of all workspace members with row-level actions:
 *   - Change role (ADMIN <-> MEMBER), admin+
 *   - Transfer ownership, owner-only, gated behind a confirm dialog
 *     since it's a one-way action that demotes the caller
 *   - Remove member, admin+
 *
 * Sorting is done client-side because we want OWNER first then by
 * role power then by created-at, and Prisma can't order an enum by
 * power without a CASE expression we'd rather not write.
 */
export function MembersTable({ members, currentUserId, isOwner, isAdmin }: Props) {
  const router = useRouter();
  const [transferTarget, setTransferTarget] = useState<MemberRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...members].sort((a, b) => {
        const p = ROLE_POWER[b.role] - ROLE_POWER[a.role];
        if (p !== 0) return p;
        return a.createdAt.getTime() - b.createdAt.getTime();
      }),
    [members],
  );

  function runAction(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusyId(id);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok && res.error) setError(res.error);
        else router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Members</CardTitle>
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
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-[60px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((m) => {
              const isSelf = m.userId === currentUserId;
              const isTargetOwner = m.role === "OWNER";
              const canActOnTarget =
                isAdmin && !isSelf && !isTargetOwner; // admins can't touch the owner; only owner can
              const canTransferToThisMember =
                isOwner && !isSelf && !isTargetOwner; // promote any non-owner

              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7">
                        {m.user.avatarUrl ? (
                          <AvatarImage src={m.user.avatarUrl} alt={m.user.name ?? m.user.email} />
                        ) : null}
                        <AvatarFallback>
                          {(m.user.name ?? m.user.email).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium leading-tight">
                          {m.user.name ?? m.user.email}
                          {isSelf && (
                            <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">{m.user.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={m.role} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.createdAt.toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {(canActOnTarget || canTransferToThisMember) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            disabled={pending && busyId === m.id}
                          >
                            {pending && busyId === m.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          {canActOnTarget && m.role === "MEMBER" && (
                            <DropdownMenuItem
                              onClick={() =>
                                runAction(m.id, () =>
                                  changeRoleAction({ membershipId: m.id, role: "ADMIN" }),
                                )
                              }
                            >
                              Promote to admin
                            </DropdownMenuItem>
                          )}
                          {canActOnTarget && m.role === "ADMIN" && (
                            <DropdownMenuItem
                              onClick={() =>
                                runAction(m.id, () =>
                                  changeRoleAction({ membershipId: m.id, role: "MEMBER" }),
                                )
                              }
                            >
                              Demote to member
                            </DropdownMenuItem>
                          )}
                          {canTransferToThisMember && (
                            <DropdownMenuItem onClick={() => setTransferTarget(m)}>
                              Transfer ownership…
                            </DropdownMenuItem>
                          )}
                          {canActOnTarget && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() =>
                                  runAction(m.id, () =>
                                    removeMemberAction({ membershipId: m.id }),
                                  )
                                }
                              >
                                Remove from workspace
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={Boolean(transferTarget)} onOpenChange={(o) => !o && setTransferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer ownership</DialogTitle>
            <DialogDescription>
              {transferTarget && (
                <>
                  This makes <b>{transferTarget.user.name ?? transferTarget.user.email}</b> the
                  workspace owner and demotes you to admin. You can't undo this without their
                  cooperation.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!transferTarget) return;
                const target = transferTarget;
                setTransferTarget(null);
                runAction(target.id, () =>
                  transferOwnershipAction({ membershipId: target.id }),
                );
              }}
              disabled={pending}
            >
              Confirm transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const Icon = role === "OWNER" ? Crown : role === "ADMIN" ? Shield : UserIcon;
  const variant: React.ComponentProps<typeof Badge>["variant"] =
    role === "OWNER" ? "default" : role === "ADMIN" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className="size-3" />
      {role}
    </Badge>
  );
}
