import test from "node:test";
import assert from "node:assert/strict";
import { parseStaffAccess, staffLanding } from "../src/frontend/staffAccess.ts";

test("every single authorized staff section lands directly without a chooser", () => {
  for (const [code, path] of [
    ["ADMIN", "/admin"],
    ["RECEPTION", "/reception"],
    ["GUARD", "/guard"],
    ["COORDINATION", "/coordination"],
  ]) {
    assert.equal(
      staffLanding(
        parseStaffAccess({
          displayName: "Test user",
          workspaces: [{ code, name: code, path: "https://untrusted.invalid" }],
        }),
      ),
      path,
    );
  }
});
test("multi-section landing is deterministic and never invents an assignment", () => {
  assert.equal(
    staffLanding(
      parseStaffAccess({
        displayName: "Test user",
        workspaces: [
          { code: "COORDINATION", name: "Visits" },
          { code: "ADMIN", name: "Admin" },
        ],
      }),
    ),
    "/admin",
  );
  assert.equal(
    staffLanding(
      parseStaffAccess({ displayName: "Test user", workspaces: [] }),
    ),
    null,
  );
});

test('flat admin navigation reflects granted capabilities without inheriting another role privileges',()=>{
  const base={displayName:'Scoped admin',workspaces:[{code:'ADMIN',name:'Administration'},{code:'COORDINATION',name:'Planning'}]};
  assert.deepEqual(parseStaffAccess({...base,grants:[{roleCode:'PROJECT_ADMIN',capabilities:['REPORTS_READ','VISITS_READ']}]}).adminSections,['overview','projects','offices','reports']);
  assert.deepEqual(parseStaffAccess({...base,grants:[{roleCode:'GUARD',capabilities:['AUDIT_READ','ROLE_GRANTS_MANAGE','GUARDS_MANAGE']}]}).adminSections,['projects','offices']);
});
test("navigation rejects malformed and duplicate grants, ignoring caller-supplied destinations", () => {
  for (const workspaces of [
    [{ code: "UNKNOWN", name: "Unsafe" }],
    [
      { code: "ADMIN", name: "Admin" },
      { code: "ADMIN", name: "Again" },
    ],
    [{ code: "ADMIN", name: "" }],
    Array(5).fill({ code: "ADMIN", name: "Admin" }),
  ])
    assert.throws(() => parseStaffAccess({ displayName: "Test", workspaces }));
  assert.deepEqual(
    parseStaffAccess({
      displayName: "Test",
      workspaces: [
        { code: "GUARD", name: "Guard", path: "//untrusted.invalid" },
      ],
    }),
    { displayName: "Test", workspaces: [{ code: "GUARD", name: "Guard" }] },
  );
});
