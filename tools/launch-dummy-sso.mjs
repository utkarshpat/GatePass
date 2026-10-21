import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePowerShell } from '../src/development/PowerShellRuntime.mjs';

try {
  if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_ONLY');
  const runtime = resolvePowerShell();
  const child = spawn(runtime, ['-NoProfile', '-File', fileURLToPath(new URL('./Start-DummySso.ps1', import.meta.url))], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, GATEPASS_PWSH_PATH: runtime },
  });
  child.on('error', () => { console.error('Unable to start the installed PowerShell runtime.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('Local development needs an existing PowerShell 7 runtime. Set GATEPASS_PWSH_PATH to its approved pwsh.exe path. Execution policy is unchanged.');
  process.exitCode = 1;
}
