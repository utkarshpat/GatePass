from pathlib import Path
import datetime
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parent.parent
validation = root / 'database/validation'
evidence = validation / 'dummy-sso-full-unit-tests.txt'
content = evidence.read_text(encoding='utf-8-sig')
for name, value in [('tests', 200), ('pass', 200), ('fail', 0)]:
    assert re.search(r'^# ' + name + r' ' + str(value) + r'\s*$', content, re.M), name
integration = json.loads((validation / 'dummy-sso-integration-report.json').read_text(encoding='utf-8-sig'))
assert integration['status'] == 'PASS' and integration['cases'] == 10 and integration['cleanedOwnedFixtures']
syntax = json.loads((validation / 'sql-syntax-report.json').read_text(encoding='utf-8-sig'))
assert all(row['ErrorCount'] == 0 for row in syntax['Results'])
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
paths = sorted({*root.glob('src/**/*.ts'), *root.glob('tests/*.test.ts'), *root.glob('src/development/*.html'),
    root / 'database/development/002_dummy_employee_sso.sql', root / 'tools/GatePass.DevelopmentSqlBridge.ps1',
    root / 'tools/Start-DummySso.ps1', root / 'tools/New-DevelopmentTls.ps1', root / 'tools/start-dummy-sso.ts', root / 'tools/start-api.ts',
    root / 'tests/dummy-sso.sql-integration.ts', root / 'database/tests/Test-DummySso.ps1', root / 'package.json', root / 'package-lock.json'})
report = dict(status='PASS', checkedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    nodeVersion=subprocess.check_output(['node', '--version'], text=True).strip(), tests=200, passed=200, failed=0,
    newDummySsoUnitTests=15, actualLocalHttpsSqlIntegrationCases=10, sqlSyntaxFiles=len(syntax['Results']), sqlSyntaxErrors=0,
    productionDriverConnectionTested=False, realSsoProviderImplemented=False, browserAcceptance=False, mailSent=False,
    physicalPrinterTesting='Deferred to final acceptance',
    evidence=[dict(file=p.relative_to(root).as_posix(), sha256=digest(p)) for p in [evidence, validation / 'dummy-sso-integration-report.json']],
    sourceSha256=[dict(file=p.relative_to(root).as_posix(), sha256=digest(p)) for p in paths])
(validation / 'dummy-sso-unit-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('PASS: current 200-unit, 10 actual local HTTPS/SQL and SQL syntax evidence recorded.')
