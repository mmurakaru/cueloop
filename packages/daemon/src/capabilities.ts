/**
 * Daemon roles: which primitives a connection may call. A connection is a
 * collaborator until it proves ownership with the owner token in daemon.hello
 * - never an owner by default. The owner (the local planner) may call every
 * primitive; a collaborator or a review-side agent is capped to reading the
 * session and adding comments, so a bring-your-own agent cannot resolve,
 * rewrite, cut, share, or delete (ADR 0009). The table below is exhaustive
 * over the primitive schemas: adding a primitive without naming its roles
 * does not compile.
 */

import * as v from "valibot";
import type { MethodName } from "./validate";

export type DaemonRole = "owner" | "collaborator" | "agent";

/** Who may call a primitive: everyone, or the owner only. */
type Audience = "any" | "owner";

const PRIMITIVE_ROLES = {
  "daemon.ping": "any",
  "daemon.hello": "any",
  "daemon.shutdown": "owner",
  "events.subscribe": "any",
  "session.create": "owner",
  "session.get": "any",
  "session.list": "any",
  "session.wait": "any",
  "session.annotate": "any",
  // any role may call it; a non-owner must act on behalf of an author and stays scoped to it
  "session.removeAnnotation": "any",
  "session.setParticipantName": "any",
  "session.setWorkingCopy": "owner",
  "session.cutBlock": "owner",
  "session.restoreBlock": "owner",
  "session.curate": "owner",
  "session.setViewed": "owner",
  "session.setTitle": "owner",
  // the tree is the owner's: collaborators comment on the branch a share follows
  "session.navigate": "owner",
  "session.branch": "owner",
  "session.switch": "owner",
  "session.label": "owner",
  "session.fork": "owner",
  "session.refreshDiff": "owner",
  "session.setShareId": "owner",
  "session.delete": "owner",
  "session.mergeShared": "owner",
  "session.resolve": "owner",
  "session.submitRevision": "owner",
  "herdr.getTab": "owner",
  "herdr.setTab": "owner",
} as const satisfies Record<MethodName, Audience>;

/** Whether `role` may call `method`. */
export function roleAllowsMethod(role: DaemonRole, method: MethodName): boolean {
  return role === "owner" || PRIMITIVE_ROLES[method] === "any";
}

/** The role a connection starts with, before any proof. */
export const DEFAULT_ROLE: DaemonRole = "collaborator";

export function asDaemonRole(value: Parameters<typeof v.safeParse>[1]): DaemonRole {
  const result = v.safeParse(v.picklist(["owner", "collaborator"]), value);

  return result.success ? result.output : "agent";
}
