import { DirectoryGateway, MockDirectorySource } from '../src/integrations/directory/DirectoryGateway.ts';
// Explicit mock mode is required; no runtime or production fallback is enabled.
const gateway = new DirectoryGateway(new MockDirectorySource());
process.stdout.write(JSON.stringify(await gateway.getSnapshot()));
