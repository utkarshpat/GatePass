import { readFile } from 'node:fs/promises';

export type Employee = {
  employeeId: string; displayName: string; officialEmail: string;
  managerEmployeeId: string | null; isActive: boolean; projectCodes: string[];
};
export type Project = {
  projectCode: string; projectName: string; isActive: boolean; locationCodes: string[];
};
export type DirectorySnapshot = { schemaVersion: 1; employees: Employee[]; projects: Project[] };
export interface DirectorySource {
  readSnapshot(): Promise<unknown>;
  getEmployee(employeeId: string): Promise<unknown | null>;
  getProject(projectCode: string): Promise<unknown | null>;
  getHostCandidates(projectCode: string, locationCode: string): Promise<unknown[]>;
}

export class DirectoryContractError extends Error {
  constructor(message: string) { super(message); this.name = 'DirectoryContractError'; }
}

const locations = new Set(['NOIDA', 'BENGALURU', 'CHENNAI', 'PUNE']);
const requireCondition = (value: unknown, message: string): void => {
  if (!value) throw new DirectoryContractError(message);
};
const record = (value: unknown): Record<string, unknown> => {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'Directory record must be an object.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum: number, field: string): string => {
  requireCondition(typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value), `Invalid directory field: ${field}.`);
  return value as string;
};
const boolean = (value: unknown): boolean => {
  requireCondition(typeof value === 'boolean', 'Directory activity must be a boolean.');
  return value as boolean;
};
const list = (value: unknown): unknown[] => {
  requireCondition(Array.isArray(value), 'Directory list is required.');
  return value as unknown[];
};
const identifiers = (value: unknown, maximum: number, field: string): string[] => {
  const result = list(value).map(item => text(item, maximum, field));
  requireCondition(new Set(result).size === result.length, 'Duplicate directory relationship.');
  return result;
};

function normalizeEmployee(input: unknown): Employee {
  const row = record(input);
  const officialEmail = text(row.officialEmail, 320, 'officialEmail');
  requireCondition(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(officialEmail), 'Invalid official email.');
  return { employeeId: text(row.employeeId, 64, 'employeeId'), displayName: text(row.displayName, 200, 'displayName'), officialEmail,
    managerEmployeeId: row.managerEmployeeId === null ? null : text(row.managerEmployeeId, 64, 'managerEmployeeId'),
    isActive: boolean(row.isActive), projectCodes: identifiers(row.projectCodes, 80, 'projectCode') };
}
function normalizeProject(input: unknown): Project {
  const row = record(input);
  const locationCodes = identifiers(row.locationCodes, 16, 'locationCode');
  requireCondition(locationCodes.every(code => locations.has(code)), 'Unknown directory location.');
  return { projectCode: text(row.projectCode, 80, 'projectCode'), projectName: text(row.projectName, 200, 'projectName'), isActive: boolean(row.isActive), locationCodes };
}

/** Normalized integration DTOs follow the applied SQL field limits. No DDL is generated.
 * Unknown upstream fields are dropped rather than exposed through this gateway.
 */
export function normalizeDirectorySnapshot(input: unknown): DirectorySnapshot {
  const data = record(input);
  requireCondition(data.schemaVersion === 1, 'Unsupported directory schema version.');
  const projects: Project[] = list(data.projects).map(normalizeProject);
  const projectMap = new Map(projects.map(project => [project.projectCode, project]));
  requireCondition(projectMap.size === projects.length, 'Duplicate directory project.');
  const employees: Employee[] = list(data.employees).map(normalizeEmployee);
  requireCondition(employees.every(employee => employee.projectCodes.every(code => projectMap.has(code))), 'Unknown employee project.');
  const employeeMap = new Map(employees.map(employee => [employee.employeeId, employee]));
  requireCondition(employeeMap.size === employees.length, 'Duplicate directory employee.');
  const visited = new Set<string>();
  for (const employee of employees) {
    const path = new Set<string>();
    let current: Employee | undefined = employee;
    while (current && !visited.has(current.employeeId)) {
      requireCondition(!path.has(current.employeeId), 'Cyclic manager relationship.');
      path.add(current.employeeId);
      const manager: string | null = current.managerEmployeeId;
      requireCondition(manager === null || employeeMap.has(manager), 'Unknown manager reference.');
      current = manager === null ? undefined : employeeMap.get(manager);
    }
    for (const id of path) visited.add(id);
  }
  return { schemaVersion: 1, employees, projects };
}

function requireMockMode(): void {
  requireCondition(['development', 'test'].includes(process.env.NODE_ENV ?? '') && process.env.GATEPASS_DIRECTORY_MODE === 'mock', 'Mock directory requires explicit development/test mode.');
}

export class MockDirectorySource implements DirectorySource {
  constructor() { requireMockMode(); }
  async readSnapshot(): Promise<unknown> {
    requireMockMode();
    return JSON.parse(await readFile(new URL('../../../database/development/directory-fixtures.json', import.meta.url), 'utf8'));
  }
  async getEmployee(employeeId: string): Promise<unknown | null> {
    return normalizeDirectorySnapshot(await this.readSnapshot()).employees.find(employee => employee.employeeId === employeeId) ?? null;
  }
  async getProject(projectCode: string): Promise<unknown | null> {
    return normalizeDirectorySnapshot(await this.readSnapshot()).projects.find(project => project.projectCode === projectCode) ?? null;
  }
  async getHostCandidates(projectCode: string, _locationCode: string): Promise<unknown[]> {
    return normalizeDirectorySnapshot(await this.readSnapshot()).employees.filter(employee => employee.projectCodes.includes(projectCode));
  }
}

/** Supply the real authenticated fetch-and-map function here when the API is ready.
 * API failures propagate; there is no automatic fallback to mock identities.
 */
export type ApiDirectoryHandlers = {
  getEmployee: (employeeId: string) => Promise<unknown | null>;
  getProject: (projectCode: string) => Promise<unknown | null>;
  getHostCandidates: (projectCode: string, locationCode: string) => Promise<unknown[]>;
  readSnapshot?: () => Promise<unknown>;
};
export class ApiDirectorySource implements DirectorySource {
  #handlers: ApiDirectoryHandlers;
  constructor(handlers: ApiDirectoryHandlers) { this.#handlers = handlers; }
  async readSnapshot(): Promise<unknown> {
    if (!this.#handlers.readSnapshot) throw new DirectoryContractError('Bulk directory sync API is not configured.');
    return await this.#handlers.readSnapshot();
  }
  async getEmployee(employeeId: string): Promise<unknown | null> { return await this.#handlers.getEmployee(employeeId); }
  async getProject(projectCode: string): Promise<unknown | null> { return await this.#handlers.getProject(projectCode); }
  async getHostCandidates(projectCode: string, locationCode: string): Promise<unknown[]> { return await this.#handlers.getHostCandidates(projectCode, locationCode); }
}

/** Internal server-side boundary, not an authentication provider or public directory endpoint.
 * Guard roles/allocations remain application-owned in SQL and are not sourced here.
 */
export class DirectoryGateway {
  #source: DirectorySource;
  constructor(source: DirectorySource) { this.#source = source; }
  async getSnapshot(): Promise<DirectorySnapshot> { return normalizeDirectorySnapshot(await this.#source.readSnapshot()); }
  async getEmployee(employeeId: string): Promise<Employee | null> {
    const input = await this.#source.getEmployee(employeeId);
    if (input === null) return null;
    const employee = normalizeEmployee(input);
    requireCondition(employee.employeeId === employeeId, 'Directory employee lookup returned a different identity.');
    return employee;
  }
  async getManager(employeeId: string): Promise<Employee | null> {
    const subject = await this.getEmployee(employeeId);
    if (!subject?.managerEmployeeId || subject.managerEmployeeId === employeeId) return null;
    const manager = await this.getEmployee(subject.managerEmployeeId);
    return manager?.isActive ? manager : null;
  }
  async getProjectMemberships(employeeId: string): Promise<string[]> {
    const employee = await this.getEmployee(employeeId);
    return employee?.isActive ? employee.projectCodes : [];
  }
  async getHostCandidates(projectCode: string, locationCode: string): Promise<Employee[]> {
    const input = await this.#source.getProject(projectCode);
    if (input === null) return [];
    const project = normalizeProject(input);
    requireCondition(project.projectCode === projectCode, 'Directory project lookup returned a different identity.');
    if (!project.isActive || !project.locationCodes.includes(locationCode)) return [];
    const employees = list(await this.#source.getHostCandidates(projectCode, locationCode)).map(normalizeEmployee);
    requireCondition(new Set(employees.map(employee => employee.employeeId)).size === employees.length, 'Duplicate directory host.');
    return employees.filter(employee => employee.isActive && employee.projectCodes.includes(projectCode));
  }
}
