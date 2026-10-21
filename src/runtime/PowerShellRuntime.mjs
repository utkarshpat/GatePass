import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/** Discover an existing runtime; never install it or change PATH/execution policy. */
export function resolvePowerShell(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const windows = (options.platform ?? process.platform) === 'win32';
  const exists = options.exists ?? (path => { try { return statSync(path).isFile(); } catch { return false; } });
  if (env.GATEPASS_PWSH_PATH) {
    const explicit = resolve(env.GATEPASS_PWSH_PATH);
    if (!exists(explicit)) throw new Error('CONFIGURED_POWERSHELL_NOT_FOUND');
    return explicit;
  }
  const executable = windows ? 'pwsh.exe' : 'pwsh';
  const paths = (env.PATH ?? env.Path ?? '').split(windows ? ';' : delimiter).filter(Boolean);
  const candidates = paths.map(path => join(path, executable));
  if (windows) {
    if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, 'PowerShell', '7', executable));
    candidates.push(join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell', executable));
  }
  const found = candidates.find(exists);
  if (!found) throw new Error('POWERSHELL_7_NOT_FOUND');
  return found;
}
