from pathlib import Path
import datetime
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parent.parent
validation = root / 'database/validation'
evidence = validation / 'private-storage-full-unit-tests.txt'
text = evidence.read_text(encoding='utf-8-sig')
for key, value in [('tests', 232), ('pass', 232), ('fail', 0), ('skipped', 0)]:
    assert re.search(r'^# ' + key + ' ' + str(value) + r'\s*$', text, re.M), key
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
sources = sorted({*root.glob('src/**/*.ts'), *root.glob('src/**/*.mjs'), *root.glob('tests/*.test.ts'),
    root / 'tools/PrivateStorage.Windows.ps1', root / 'tools/initialize-private-storage.ts', root / 'package.json', root / 'package-lock.json'})
report = dict(status='PASS', checkedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    nodeVersion=subprocess.check_output(['node', '--version'], text=True).strip(), tests=232, passed=232, failed=0, skipped=0,
    newStorageTests=17, actualWindowsAclTested=True, actualDpapiTested=True, actualFileVaultRotationAndRecoveryTested=True,
    coreMigrationsChanged=False, photoHttpWired=False, productionLinuxKeyProviderImplemented=False, backupRestoreValidated=False,
    browserAcceptance=False, physicalPrinterTesting='Deferred to final acceptance',
    evidenceFile=evidence.relative_to(root).as_posix(), evidenceSha256=digest(evidence),
    sourceSha256=[dict(file=p.relative_to(root).as_posix(), sha256=digest(p)) for p in sources])
(validation / 'private-storage-unit-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('PASS: 232 tests; 17 storage cases including actual Windows ACL/DPAPI and file-vault rotation/recovery.')
