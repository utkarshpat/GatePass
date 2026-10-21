import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ApiDirectorySource, DirectoryContractError, DirectoryGateway, MockDirectorySource, normalizeDirectorySnapshot } from '../src/integrations/directory/DirectoryGateway.ts';

const fixture = JSON.parse(await readFile(new URL('../database/development/directory-fixtures.json', import.meta.url), 'utf8'));
process.env.NODE_ENV = 'test';
process.env.GATEPASS_DIRECTORY_MODE = 'mock';
const gateway = new DirectoryGateway(new MockDirectorySource());
const altered = (): any => structuredClone(fixture);
const apiFromSnapshot = (data: any): ApiDirectorySource => new ApiDirectorySource({
  getEmployee: async id => data.employees.find((employee: any) => employee.employeeId === id) ?? null,
  getProject: async code => data.projects.find((project: any) => project.projectCode === code) ?? null,
  getHostCandidates: async code => data.employees.filter((employee: any) => employee.projectCodes.includes(code)),
  readSnapshot: async () => data,
});

test('dummy directory contains twenty-four employees and six projects', async () => {
  const snapshot = await gateway.getSnapshot();
  assert.equal(snapshot.employees.length, 24);
  assert.equal(snapshot.projects.length, 6);
});
test('managers are mapped from the same employee population', async () => {
  assert.equal((await gateway.getManager('EMP001'))?.employeeId, 'EMP019');
  assert.equal((await gateway.getManager('EMP010'))?.employeeId, 'EMP022');
  assert.equal((await gateway.getManager('EMP019'))?.employeeId, 'EMP023');
  assert.equal(await gateway.getManager('EMP023'), null);
});
test('unknown employee and manager lookups do not invent identities', async () => {
  assert.equal(await gateway.getEmployee('UNKNOWN'), null);
  assert.equal(await gateway.getManager('UNKNOWN'), null);
});
test('project/location host lookup enforces project availability', async () => {
  const people = await gateway.getHostCandidates('DEMO-PRJ-001', 'NOIDA');
  assert(people.some(person => person.employeeId === 'EMP001'));
  assert(!people.some(person => person.employeeId === 'EMP003'));
  assert.deepEqual(await gateway.getHostCandidates('DEMO-PRJ-002', 'CHENNAI'), []);
});
test('returned records cannot mutate the underlying source', async () => {
  const employee = await gateway.getEmployee('EMP001');
  assert(employee);
  employee.displayName = 'Edited';
  employee.projectCodes.length = 0;
  assert.equal((await gateway.getEmployee('EMP001'))?.displayName, 'Employee 1');
  assert.deepEqual(await gateway.getProjectMemberships('EMP001'), ['DEMO-PRJ-001']);
});
test('inactive employees have no host or active membership result', async () => {
  const data = altered(); data.employees[0].isActive = false;
  const local = new DirectoryGateway(apiFromSnapshot(data));
  assert.equal((await local.getEmployee('EMP001'))?.isActive, false);
  assert.deepEqual(await local.getProjectMemberships('EMP001'), []);
  assert(!(await local.getHostCandidates('DEMO-PRJ-001', 'NOIDA')).some(employee => employee.employeeId === 'EMP001'));
});
test('inactive managers are returned as unavailable', async () => {
  const data = altered(); data.employees.find((employee: any) => employee.employeeId === 'EMP019').isActive = false;
  assert.equal(await new DirectoryGateway(apiFromSnapshot(data)).getManager('EMP001'), null);
});
test('duplicate employee IDs are rejected', () => {
  const data = altered(); data.employees.push(data.employees[0]);
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
});
test('missing manager references are rejected', () => {
  const data = altered(); data.employees[0].managerEmployeeId = 'MISSING';
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
});
test('self-manager and multi-person manager cycles are rejected', () => {
  const data = altered(); data.employees[0].managerEmployeeId = 'EMP001';
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
  data.employees[0].managerEmployeeId = 'EMP019'; data.employees.find((employee: any) => employee.employeeId === 'EMP019').managerEmployeeId = 'EMP001';
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
});
test('unknown projects and locations fail closed', () => {
  const data = altered(); data.employees[0].projectCodes = ['MISSING'];
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
  data.employees[0].projectCodes = ['DEMO-PRJ-001']; data.projects[0].locationCodes = ['UNKNOWN'];
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
});
test('malformed official emails and activity flags are rejected', () => {
  const data = altered(); data.employees[0].officialEmail = 'not-an-email';
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
  data.employees[0].officialEmail = 'employee1@example.com'; data.employees[0].isActive = 'true';
  assert.throws(() => normalizeDirectorySnapshot(data), DirectoryContractError);
});
test('extra upstream fields and guard permissions do not propagate into the DTO', () => {
  const data = altered(); data.employees[0].password = 'synthetic-ignored'; data.guards = [{ role: 'INDIA_ADMIN' }];
  const normalized = normalizeDirectorySnapshot(data);
  assert(!('password' in normalized.employees[0])); assert(!('guards' in normalized));
});
test('API source failures propagate without mock fallback', async () => {
  const source = apiFromSnapshot(fixture);
  source.getEmployee = async () => { throw new Error('UPSTREAM_UNAVAILABLE'); };
  const local = new DirectoryGateway(source);
  await assert.rejects(local.getEmployee('EMP001'), /UPSTREAM_UNAVAILABLE/);
});
test('actual API mapping can replace the source without changing consumers', async () => {
  let calls = 0;
  const source = apiFromSnapshot(fixture);
  source.getEmployee = async id => { calls++; return fixture.employees.find((employee: any) => employee.employeeId === id) ?? null; };
  const local = new DirectoryGateway(source);
  assert.equal((await local.getEmployee('EMP002'))?.displayName, 'Employee 2');
  assert.equal(calls, 1);
});
test('manager API failure cannot prevent the separate employee lookup', async () => {
  const source = apiFromSnapshot(fixture);
  source.getEmployee = async id => {
    if (id === 'EMP019') throw new Error('MANAGER_API_UNAVAILABLE');
    return fixture.employees.find((employee: any) => employee.employeeId === id) ?? null;
  };
  const local = new DirectoryGateway(source);
  assert.equal((await local.getEmployee('EMP001'))?.employeeId, 'EMP001');
  await assert.rejects(local.getManager('EMP001'), /MANAGER_API_UNAVAILABLE/);
});
test('API response cannot substitute another employee identity', async () => {
  const source = apiFromSnapshot(fixture); source.getEmployee = async () => fixture.employees[1];
  await assert.rejects(new DirectoryGateway(source).getEmployee('EMP001'), DirectoryContractError);
});
test('mock directory is forbidden in production and without explicit opt-in', async () => {
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => new MockDirectorySource(), DirectoryContractError);
    await assert.rejects(gateway.getSnapshot(), DirectoryContractError);
    process.env.NODE_ENV = 'test'; delete process.env.GATEPASS_DIRECTORY_MODE;
    assert.throws(() => new MockDirectorySource(), DirectoryContractError);
  } finally { process.env.NODE_ENV = 'test'; process.env.GATEPASS_DIRECTORY_MODE = 'mock'; }
});


test('same project in another office does not make an employee an eligible host', async () => {
  assert(!(await gateway.getHostCandidates('DEMO-PRJ-001','BENGALURU')).some(e => e.employeeId==='EMP001'));
  assert((await gateway.getHostCandidates('DEMO-PRJ-001','NOIDA')).some(e => e.employeeId==='EMP001'));
});
test('missing, duplicated and unbound employee office assignments fail closed', () => {
  let data=altered();delete data.employees[0].locationCodes;
  assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
  data=altered();delete data.employees[0].projectLocations;
  assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
  data=altered();data.employees[0].projectLocations.push({projectCode:'DEMO-PRJ-001',locationCode:'BENGALURU'});
  assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
  data=altered();data.employees[0].projectLocations.push(data.employees[0].projectLocations[0]);
  assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
});
test('project office and employee office lists never imply a Cartesian entitlement', async () => {
  const data=altered();data.employees[0].locationCodes.push('BENGALURU');
  const local=new DirectoryGateway(apiFromSnapshot(data));
  assert(!(await local.getHostCandidates('DEMO-PRJ-001','BENGALURU')).some(e=>e.employeeId==='EMP001'));
  data.employees[0].projectLocations.push({projectCode:'DEMO-PRJ-001',locationCode:'BENGALURU'});
  assert((await local.getHostCandidates('DEMO-PRJ-001','BENGALURU')).some(e=>e.employeeId==='EMP001'));
});
test('an employee assignment cannot name an office outside the project', () => {
  const data=altered();data.employees[0].locationCodes.push('CHENNAI');data.employees[0].projectCodes.push('DEMO-PRJ-002');
  data.employees[0].projectLocations.push({projectCode:'DEMO-PRJ-002',locationCode:'CHENNAI'});
  assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
});


test('each advertised synthetic project office has an explicitly assigned local host', async () => {
  const data=await gateway.getSnapshot();
  for(const project of data.projects)for(const location of project.locationCodes) {
    const candidates=await gateway.getHostCandidates(project.projectCode,location);
    assert(candidates.length>0,project.projectCode+' '+location+' has no explicit local host');
    assert(candidates.every(e=>e.locationCodes.includes(location)&&e.projectLocations.some(p=>p.projectCode===project.projectCode&&p.locationCode===location)));
  }
});


test('primary office is an explicit API field inside the trusted office assignments',async()=>{
  assert.equal((await gateway.getEmployee('EMP020'))?.primaryOfficeLocationCode,'BENGALURU');
  const data=altered();delete data.employees[0].primaryOfficeLocationCode;assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
  data.employees[0].primaryOfficeLocationCode='BENGALURU';assert.throws(()=>normalizeDirectorySnapshot(data),DirectoryContractError);
});
