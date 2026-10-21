import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SqlStaffAdministrationRepository, StaffAdministrationService } from '../src/administration/StaffAdministrationService.ts';
let input = ''; for await (const part of process.stdin) input += part; const fixture = JSON.parse(input);
const bridge = fileURLToPath(new URL('./helpers/StaffAdministration.SqlBridge.ps1', import.meta.url));
const client = { async callProcedure(procedure: string, parameters: Record<string, any>) {
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(fixture.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('STAFF_BRIDGE_TIMEOUT')); }, 15000);
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume(); child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('STAFF_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: fixture.server, trustLocalCertificate: fixture.trustLocalCertificate, procedure,
      parameters: Object.fromEntries(Object.entries(parameters).map(([key, p]) => [key, { type: p.type, value: Buffer.isBuffer(p.value) ? p.value.toString('base64') : p.value }])) }));
  }); const result = JSON.parse(text); if (result.bridgeError) throw { number: result.number }; return text;
} };
const service = new StaffAdministrationService(new SqlStaffAdministrationRepository(client));
const cases: { name: string; passed: boolean }[] = []; async function check(name: string, action: () => Promise<void>) { await action(); cases.push({ name, passed: true }); }
const allocation = { clientKey: randomUUID(), guardUserId: fixture.guardUserId, projectLocationId: fixture.projectLocationId, reason: 'Synthetic backend project cover' };
const grant = { clientKey: randomUUID(), targetUserId: fixture.targetUserId, roleCode: 'RECEPTION', scopeType: 'LOCATION', locationId: fixture.locationId, capabilities: ['VISITS_READ', 'PASS_PRINT'], reason: 'Synthetic reception duty' };
let assignment: any; let role: any;
await check('actual typed allocation creates the scoped assignment with string bigint receipt', async () => {
  assignment = await service.allocate(fixture.admin, allocation); assert.equal(assignment.status, 'ALLOCATED'); assert.equal(typeof assignment.assignmentId, 'string'); assert(!JSON.stringify(assignment).includes('reason'));
});
await check('actual allocation retry preserves one historical receipt', async () => { assert.deepEqual(await service.allocate(fixture.admin, allocation), assignment); });
await check('existing deallocation RPC interoperates through the same strict service', async () => {
  const result = await service.deallocate(fixture.admin, { clientKey: randomUUID(), assignmentId: assignment.assignmentId, reason: 'Coverage ended' }); assert.equal(result.deallocated, true);
});
await check('actual role grant commits only the explicit capability set', async () => {
  role = await service.grant(fixture.host, grant); assert.equal(role.status, 'GRANTED'); assert.equal(role.targetUserId, fixture.targetUserId.toLowerCase()); assert(!/reason|capabilities|session/u.test(JSON.stringify(role)));
});
await check('reordered capabilities retry the same actual grant', async () => { assert.deepEqual(await service.grant(fixture.host, { ...grant, capabilities: [...grant.capabilities].reverse() }), role); });
await check('actual role revocation returns the bounded reference receipt', async () => {
  const result = await service.revoke(fixture.host, { clientKey: randomUUID(), roleGrantId: role.roleGrantId, reason: 'Duties ended' }); assert.equal(result.revoked, true); assert.equal(result.targetUserId, grant.targetUserId.toLowerCase());
});
await check('unprivileged active session cannot delegate roles through the real SQL boundary', async () => {
  await assert.rejects(service.grant(fixture.unprivileged, { ...grant, clientKey: randomUUID() }), /NOT_AUTHORIZED/u);
});
process.stdout.write(JSON.stringify({ Status: 'PASS', CaseCount: cases.length, Cases: cases, NodeVersion: process.version, ActualRestrictedSqlServiceIntegration: true,
  ProductionSqlDriver: false, BrowserOrHttpAcceptance: false, PhysicalPrinterTesting: 'Deferred to final acceptance', RealPrincipalsOrMessagesCreated: false }));
