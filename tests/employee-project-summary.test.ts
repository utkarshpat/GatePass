import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { employeeProjectSummary } from '../src/visits/EmployeeProjectSummary.ts';

test('employee project summary keeps bounded names, total and stale state without copying private fields', () => {
  assert.deepEqual(employeeProjectSummary({ available: true, total: 4, items: [{ name: 'A', secret: 'private' }, { name: 'B' }, { name: 'C' }], secret: 'private' }),
    { available: true, total: 4, items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  assert.deepEqual(employeeProjectSummary({ available: false, total: null, items: [] }), { available: false, total: null, items: [] });
  assert.deepEqual(employeeProjectSummary({ available: true, total: 0, items: [] }), { available: true, total: 0, items: [] });
});
test('malformed, partial and oversized assignment summaries fail closed', () => {
  for (const value of [null, [], {}, { available: false, total: 0, items: [] }, { available: true, total: 4, items: [{ name: 'A' }] },
    { available: true, total: 4, items: Array(4).fill({ name: 'A' }) }, { available: true, total: -1, items: [] },
    { available: true, total: '1', items: [{ name: 'A' }] }, { available: true, total: 1, items: [{ name: '' }] },
    { available: true, total: 1, items: [{ name: 'A'.repeat(201) }] }, { available: true, total: 1, items: [{ name: '\ud800' }] }]) assert.equal(employeeProjectSummary(value), null);
});

test('guard keeps assignment/project labels separate from person and host names, without hash symbols', () => {
  const source = readFileSync(new URL('../src/app/guard.js', import.meta.url), 'utf8');
  const context: any = { state:{duty:null}, i18n: { t(key: string, values: any = {}) { return key.replace('{count}', String(values.count)); } } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function projectTitle('), source.indexOf('function i18nNode(')) + ';globalThis.format={projectTitle,projectDescription,hostTitle,personTitle,shortPass};', context);
  const f = context.format;
  const summary = { available: true, total: 4, items: [{ name: 'Assigned A' }, { name: 'Assigned B' }, { name: 'Assigned C' }] };
  const employee = { requestType: 'DIGITAL_ID', projectName: null, employeeProjects: summary };
  assert.equal(f.projectTitle(employee), 'Assigned A · Assigned B · Assigned C · 1 more');
  const extra = { requestType: 'EMPLOYEE_PROJECT', projectName: 'Requested project', hostName: 'Host One', employeeProjects: summary };
  assert.equal(f.projectTitle(extra), 'Requested project');
  assert.equal(f.hostTitle(extra), 'Host One');
  assert.equal(f.projectDescription({ requestType: 'DIGITAL_ID', employeeProjects: { available: false } }), 'Assignments unavailable.');
  assert.equal(f.projectDescription({ requestType: 'DIGITAL_ID', employeeProjects: { available: true, total: 0, items: [] } }), 'No assigned projects');
  assert.equal(f.shortPass('GP-abcdef123456'), 'ABCDEF');
  assert.equal(f.personTitle('Employee One'), 'Employee One');
  assert.ok(!f.shortPass('GP-abcdef123456').includes('#'));
});
