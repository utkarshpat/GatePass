import type { Detail } from "./types.ts";

/** Presentation only. Commands continue to use the server's canEdit/canDecide checks. */
export function coordinationRole(
  detail: Pick<
    Detail,
    "actorId" | "canEdit" | "canManage" | "approvals" | "tasks"
  >,
): string {
  if (detail.canEdit) return "Visit owner";
  if (
    detail.approvals.some(
      (step) =>
        step.subProjectId &&
        (step.canDecide ||
          step.approvers?.some((person) => person.userId === detail.actorId)),
    )
  )
    return "Host";
  if (detail.canManage) return "Scope administrator";
  if (detail.approvals.some((step) => step.canDecide))
    return "Approval reviewer";
  if (detail.tasks.some((task) => task.canUpdate))
    return "Arrangement coordinator";
  return "Visit participant";
}
