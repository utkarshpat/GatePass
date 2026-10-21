from pathlib import Path
import datetime
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parent.parent
validation = root / 'database/validation'
evidence = validation / 'transport-full-unit-tests.txt'
content = evidence.read_text(encoding='utf-8-sig')
for label, expected in [('tests', 169), ('pass', 169), ('fail', 0)]:
    assert re.search(r'^# ' + label + r' ' + str(expected) + r'\s*$', content, re.M), label
identity = json.loads((validation / 'transport-identity-report.json').read_text(encoding='utf-8-sig'))
assert identity['status'] == 'PASS' and identity['cases'] == 6
audit = json.loads((validation / 'transport-dependency-audit.json').read_text(encoding='utf-8-sig'))
assert audit['metadata']['vulnerabilities']['total'] == 0
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
paths = sorted({*root.glob('src/**/*.ts'), *root.glob('src/transport/*.sql'), *root.glob('tests/*.test.ts'),
                root / 'tests/helpers/Create-TestTls.ps1', root / 'database/setup/Test-TransportIdentity.ps1',
                root / 'tools/start-api.ts', root / 'package.json', root / 'package-lock.json'})
report = dict(status='PASS', checkedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              nodeVersion=subprocess.check_output(['node', '--version'], text=True).strip(), tests=169, passed=169, failed=0,
              newTransportTests=34, actualSqlAdmissionCases=6, dependencyAuditVulnerabilities=0,
              evidenceFile='database/validation/transport-full-unit-tests.txt', evidenceSha256=digest(evidence),
              productionDriverConnectionTested=False, httpToLiveSqlEndToEndTested=False, browserAcceptance=False,
              physicalPrinterTesting='Deferred to final acceptance',
              sourceSha256=[dict(file=p.relative_to(root).as_posix(), sha256=digest(p)) for p in paths])
(validation / 'transport-unit-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('PASS: 169 units, 34 transport cases, 6 actual SQL admission cases; live driver connectivity remains unverified.')
