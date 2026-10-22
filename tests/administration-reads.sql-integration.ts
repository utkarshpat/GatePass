import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AdministrationReadService, SqlAdministrationReadRepository } from '../src/administration/AdministrationReadService.ts';
let input = ''; for await (const part of process.stdin) input += part; const fixture = JSON.parse(input);
const bridge = fileURLToPath(new URL('./helpers/AdministrationReads.SqlBridge.ps1', import.meta.url));
const client = { async callProcedure(procedure: string, parameters: Record<string, any>) {
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(fixture.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('ADMIN_READ_BRIDGE_TIMEOUT')); }, 15000);
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume(); child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('ADMIN_READ_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: fixture.server, trustLocalCertificate: fixture.trustLocalCertificate, procedure,
      parameters: Object.fromEntries(Object.entries(parameters).map(([key, p]) => [key, { type: p.type, value: Buffer.isBuffer(p.value) ? p.value.toString('base64') : p.value }])) }));
  }); const result = JSON.parse(text); if (result.bridgeError) throw { number: result.number }; return text;
} };
const service = new AdministrationReadService(new SqlAdministrationReadRepository(client));
const cases: { name: string; passed: boolean }[] = []; async function check(name: string, action: () => Promise<void>) { await action(); cases.push({ name, passed: true }); }
await check('project selector interops with actual typed RPC and current scoped eligibility', async () => {
  const r = await service.projects(fixture.admin, { locationId: fixture.locationId, pageSize: 50 }); assert(r.projects.some(row => row.projectLocationId === fixture.projectLocationId)); assert(r.projects.every(row => row.locationId === fixture.locationId));
});
await check('guard selector interops with actual interval eligibility and overlap flags', async () => {
  const r = await service.guards(fixture.admin, { projectLocationId: fixture.projectLocationId, namePrefix: 'Synthetic' }); assert.equal(r.guards.length, 3); assert.equal(r.guards.filter(row => row.canAllocate && !row.overlappingAssignment).length,2); assert.equal(r.guards.filter(row => !row.canAllocate && row.overlappingAssignment).length,1);
});
await check('role administrator searches subjects through a bounded keyset page', async () => {
  const r = await service.subjects(fixture.host, { namePrefix: 'Synthetic', pageSize: 2 }); assert.equal(r.users.length, 2); assert.equal(r.hasMore, true); assert.equal(r.afterUserId, r.users[1].userId);
});
await check('actual role history returns explicit capabilities and canonical scope values', async () => {
  const r = await service.roles(fixture.host, { targetUserId: fixture.guardUserId }); assert.equal(r.grants.length, 1); assert(r.grants[0].capabilities.includes('PROJECT_MOVEMENT')); assert.equal(r.grants[0].validUntilUtc, null);
});
await check('actual report exposes only own-project aggregates and separated presence', async () => {
  const r = await service.summary(fixture.projectAdmin, { locationId: fixture.locationId, localVisitDate: fixture.day }); assert.equal(r.visits.total, '22'); assert.equal(r.recordedPresence.digitalIdsInside, '0');
});
await check('actual audit projection respects project-wide authority and removes raw payload', async () => {
  const r = await service.audit(fixture.projectAdmin, { fromUtc: fixture.fromUtc, untilUtc: fixture.untilUtc, pageSize: 50 }); assert.equal(r.events.length, 2); assert(r.events.every(row => ['FIXTURE_PAIR_A', 'FIXTURE_PROJECT_ROLE'].includes(row.actionCode))); assert(!/metadata|targetReference|PRIVATE|credential/u.test(JSON.stringify(r)));
});
await check('scoped administrator cannot call global subject search through the real service', async () => {
  await assert.rejects(service.subjects(fixture.admin, { namePrefix: 'Synthetic' }), /NOT_AUTHORIZED/u);
});
process.stdout.write(JSON.stringify({ Status: 'PASS', CaseCount: cases.length, Cases: cases, NodeVersion: process.version, ActualRestrictedSqlServiceIntegration: true,
  ProductionSqlDriver: false, BrowserOrHttpAcceptance: false, PhysicalPrinterTesting: 'Deferred to final acceptance', RealPrincipalsOrMessagesCreated: false }));
