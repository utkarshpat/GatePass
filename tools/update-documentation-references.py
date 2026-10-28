"""Refresh non-secret source inventories. Does not access SQL, mail or credentials."""
from pathlib import Path
import hashlib,json,re,subprocess

root=Path(__file__).resolve().parent.parent
def relative(p):return p.relative_to(root).as_posix()
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
out=root/'docs/system'
migrations=sorted((root/'database/migrations').glob('*.sql'))
lines=['# SQL source catalogue','',f'Updated 28 October 2026; {len(migrations)} forward migration files. Declaration provenance is lexical source evidence, not a live catalogue or permission audit. Dynamic ALTER migrations may preserve/change existing definitions without a new literal declaration.','','## Migration hashes','','| Migration | SHA-256 |','|---|---|']
objects={}
for p in migrations:
 lines.append(f'| [{p.name}](../../database/migrations/{p.name}) | `{digest(p)}` |')
 for kind,name in re.findall(r'\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER)\s+(TABLE|PROCEDURE|FUNCTION|VIEW|ROLE)\s+((?:gp\.)?[A-Za-z_][A-Za-z0-9_]*)',p.read_text(encoding='utf8'),re.I):objects.setdefault((kind.upper(),name),[]).append(p.name[:3])
lines+=['','## Object declaration provenance','','| Kind | Object | Declaration/change migrations |','|---|---|---|']
for (kind,name),versions in sorted(objects.items()):lines.append(f'| {kind} | `{name}` | '+', '.join(dict.fromkeys(versions))+' |')
(out/'REFERENCE_SQL_Catalog.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
files=sorted([*list((root/'src').rglob('*.ts')),*list((root/'src').rglob('*.tsx')),*list((root/'src').rglob('*.js')),*list((root/'tools').rglob('*.ts')),*list((root/'tools').glob('*.mjs'))])
routes={};env={}
for p in files:
 for n,line in enumerate(p.read_text(encoding='utf8').splitlines(),1):
  for route in re.findall(r'''['"](/(?:api/|office/|approval/|request/|reception|guard|admin|pwa/)[A-Za-z0-9_./:{}-]*)['"]''',line):routes.setdefault(route,[]).append((relative(p),n))
  for name in re.findall(r'\b(?:GATEPASS_[A-Z0-9_]+|NODE_ENV)\b',line):env.setdefault(name,set()).add(relative(p))
lines=['# Routes and runtime configuration','','Updated 28 October 2026. Literal source inventory; dynamic/regex routes require checking their handlers. Not an OpenAPI schema. Names only: no live environment file or secret value is read.','','## Runtime setup','','Root `.env` is private and ignored; `.env.example` is the empty tracked template. API/email startup validates production settings. Existing process variables take precedence. Reserved corporate/Google fields do not enable unfinished adapters. See [configuration](../86_Runtime_Environment_Configuration.md).','','## Literal routes','','| Route/prefix | Source | Line |','|---|---|---|']
for route,locations in sorted(routes.items()):
 for file,n in sorted(set(locations)):lines.append(f'| `{route}` | [{file}](../../{file}) | {n} |')
lines+=['','## Configuration names','','| Name | Source files |','|---|---|']
for name,paths in sorted(env.items()):lines.append(f'| `{name}` | '+', '.join(f'[{p}](../../{p})' for p in sorted(paths))+' |')
(out/'REFERENCE_Routes_and_Configuration.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=root,text=True).splitlines()
selected=[]
for name in sorted(set(names)):
 if name.startswith(('src/','tools/','tests/','assets/','database/migrations/')) or name in ['package.json','package-lock.json','azure-pipelines.yml','.env.example','database/migrations.sha256.json']:
  p=root/name
  if p.is_file():selected.append({'path':name,'sha256':digest(p)})
snapshot={'documentDate':'2026-10-28','timezone':'Asia/Calcutta','gitBaseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'snapshot':'Reviewed working-tree source before release commit; excludes actual .env, runtime data and private artifacts','migrationCount':len(migrations),'sqlDeclarationCounts':{kind:sum(k[0]==kind for k in objects) for kind in ['TABLE','PROCEDURE','ROLE','VIEW','FUNCTION']},'sourceFiles':selected}
(out/'Source-Snapshot.json').write_text(json.dumps(snapshot,indent=2)+'\n',encoding='utf8')
print(f'Updated {len(migrations)} migration hashes, {len(routes)} literal route/prefix entries, {len(env)} configuration names and {len(selected)} source hashes.')
