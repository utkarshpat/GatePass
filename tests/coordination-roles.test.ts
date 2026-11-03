import test from "node:test";
import assert from "node:assert/strict";
import { coordinationRole } from "../src/frontend/coordination/roles.ts";

type Input = Parameters<typeof coordinationRole>[0];
const base: Input = {
  actorId: "actor",
  canEdit: false,
  canManage: false,
  approvals: [],
  tasks: [],
};
function approval(
  patch: Partial<Input["approvals"][number]> = {},
): Input["approvals"][number] {
  return {
    id: "review",
    name: "Destination permission",
    kind: "PROJECT",
    mode: "ALL",
    subProjectId: "project",
    status: "PENDING",
    approvers: [{ userId: "actor", name: "Assigned host" }],
    canDecide: false,
    canDiscuss: true,
    decisions: [],
    ...patch,
  };
}
test("the authenticated invitation creator is the Visit owner, including an owner who is also an admin", () => {
  assert.equal(
    coordinationRole({
      ...base,
      canEdit: true,
      canManage: true,
      approvals: [approval({ canDecide: true })],
    }),
    "Visit owner",
  );
});
test("destination permission reviewers are Hosts and remain Hosts after recording their decision", () => {
  assert.equal(
    coordinationRole({ ...base, approvals: [approval({ canDecide: true })] }),
    "Host",
  );
  assert.equal(
    coordinationRole({
      ...base,
      canManage: true,
      approvals: [approval({ status: "APPROVED" })],
    }),
    "Host",
  );
});
test("office security, FYI participants and scope admins do not acquire the destination Host label", () => {
  assert.equal(
    coordinationRole({
      ...base,
      approvals: [
        approval({
          subProjectId: undefined,
          kind: "SECURITY",
          canDecide: true,
        }),
      ],
    }),
    "Approval reviewer",
  );
  assert.equal(
    coordinationRole({
      ...base,
      approvals: [
        approval({ approvers: [{ userId: "other", name: "Other host" }] }),
      ],
    }),
    "Visit participant",
  );
  assert.equal(
    coordinationRole({ ...base, canManage: true }),
    "Scope administrator",
  );
});
