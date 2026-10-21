import { DirectoryGateway, MockDirectorySource } from '../src/integrations/directory/DirectoryGateway.ts';

const gateway = new DirectoryGateway(new MockDirectorySource());
const snapshot = await gateway.getSnapshot();
const hosts = [];
for (const project of snapshot.projects) {
  for (const location of ['NOIDA', 'BENGALURU', 'CHENNAI', 'PUNE']) {
    hosts.push({ project: project.projectCode, location,
      employees: (await gateway.getHostCandidates(project.projectCode, location)).map(employee => employee.employeeId).sort() });
  }
}
const managers = [];
for (const employee of snapshot.employees) {
  managers.push({ employee: employee.employeeId, manager: (await gateway.getManager(employee.employeeId))?.employeeId ?? null });
}
process.stdout.write(JSON.stringify({ hosts, managers }));
