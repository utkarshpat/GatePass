from pathlib import Path
import datetime
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parent.parent
validation = root / 'database/validation'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def check(name, count):
    path = validation / name
    content = path.read_text(encoding='utf-8-sig')
    for label, value in [('tests', count), ('pass', count), ('fail', 0)]:
        assert re.search(r'^[#ℹ]\s*' + label + r'\s+' + str(value) + r'\s*$', content, re.M), (name, label)
    return dict(file=path.relative_to(root).as_posix(), sha256=digest(path), tests=count)
evidence = [check('registration-http-full-unit-tests.txt', 185), check('registration-http-unit-tests.txt', 50)]
paths = sorted({*root.glob('src/**/*.ts'), *root.glob('src/transport/*.sql'), *root.glob('tests/*.test.ts'), root / 'tests/helpers/Create-TestTls.ps1', root / 'package.json', root / 'package-lock.json'})
report = dict(status='PASS', checkedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              nodeVersion=subprocess.check_output(['node', '--version'], text=True).strip(), tests=185, passed=185, failed=0,
              newRegistrationHttpTests=16, transportTests=50, evidence=evidence,
              productionDriverConnectionTested=False, httpToLiveSqlEndToEndTested=False,
              productionRegistrationRoutesEnabled=False, realSsoProviderImplemented=False, browserAcceptance=False,
              physicalPrinterTesting='Deferred to final acceptance',
              sourceSha256=[dict(file=p.relative_to(root).as_posix(), sha256=digest(p)) for p in paths])
(validation / 'registration-http-unit-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('PASS: 185 total units, 50 transport cases, 16 new registration HTTP/SSO-boundary cases. Rollout remains disabled.')
