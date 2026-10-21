"""Meaningful static relational checks. Does not emulate SQL Server execution."""
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'database/schema-manifest.json').read_text(encoding='utf-8-sig'))
sources=manifest['source'].get('schema_sources',[manifest['source']])
for source in sources:
    assert source['sha256']==hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest(), 'SQL-derived manifest is stale: '+source['path']
sql='\n'.join((ROOT/source['path']).read_text(encoding='utf-8') for source in sources)
TABLES=manifest['tables']
assert manifest['source']['kind']=='sql-ddl-draft'
assert manifest['source']['sha256']==hashlib.sha256((ROOT/'database/migrations/001_individual_visit_baseline.sql').read_bytes()).hexdigest(), 'SQL-derived manifest is stale; rerun export_sql_schema.ps1.'
by_name={t['name']:t for t in TABLES}
assert len(by_name)==len(TABLES)
for t in TABLES:
    cols={c['name']:c for c in t['columns']}
    assert len(cols)==len(t['columns'])
    assert all(c in cols for c in t['pk'])
    for f in t['fks']:
        target=by_name[f['target']]
        assert f['target_columns'] in [target['pk'],*target['unique']], (t['name'],f)
        target_cols={c['name']:c for c in target['columns']}
        assert len(f['columns'])==len(f['target_columns'])
        for a,b in zip(f['columns'],f['target_columns']):
            assert cols[a]['type'].replace(' IDENTITY(1,1)','')==target_cols[b]['type'].replace(' IDENTITY(1,1)',''), (t['name'],a,f['target'],b)
checks=[]


def check(label, condition):
    assert condition, label
    checks.append(label)


check('Every declared FK targets an existing compatible PK/unique key',True) # SQL-derived metadata checked exact references/types above
check('Every model table occurs once in physical DDL',len(re.findall(r'^CREATE TABLE gp\.',sql,re.M))==len(by_name))
check('Every model FK occurs in physical DDL',len(re.findall(r'\bFOREIGN KEY\b',sql))==sum(len(t['fks']) for t in TABLES))
check('Each final record is individual, without an operational participant/group table','VisitParticipants' not in by_name and 'Groups' not in by_name)
check('Registration retries have unique intake/person identity',['IntakeId','ClientPersonKey'] in by_name['VisitRequests']['unique'])
check('Photos cannot be shared as one asset across final people',['PhotoAssetId'] in by_name['VisitRequests']['unique'])
check('Photo ownership uses a composite intake FK',any(f['columns']==['PhotoAssetId','IntakeId'] for f in by_name['VisitRequests']['fks']))
check('Approval binds one individual snapshot',by_name['ApprovalDecisions']['pk']==['VisitRequestId'] and any(f['columns']==['VisitRequestId','SnapshotVersion','SnapshotHash'] for f in by_name['ApprovalDecisions']['fks']))
check('One current credential per visit has a filtered unique index','CREATE UNIQUE INDEX UX_Pass_Current ON gp.AccessPasses(VisitRequestId) WHERE IsCurrent=1;' in sql)
check('Movement cannot link another visit credential',any(f['columns']==['AccessPassId','VisitRequestId'] for f in by_name['AccessEvents']['fks']))
check('Presence last-event belongs to the same visit',any(f['columns']==['LastAccessEventId','VisitRequestId'] for f in by_name['VisitPresence']['fks']))
check('Delivery jobs cannot reference another visitor link',any(f['columns']==['DeliveryLinkId','VisitRequestId'] for f in by_name['NotificationOutbox']['fks']))
check('TEMP_ID daily slot pins employee/location/type/day',len(by_name['TemporaryIdSlots']['fks'][0]['columns'])==5)
check('Expired guard assignments do not occupy an IsActive filtered unique slot',not any(c['name']=='IsActive' for c in by_name['GuardAssignments']['columns']))
check('Manager contact can resolve without blocking pass creation',{'RecipientKind','RecipientEmployeeId','RecipientEmail'} <= {c['name'] for c in by_name['NotificationOutbox']['columns']} and next(c for c in by_name['NotificationOutbox']['columns'] if c['name']=='RecipientEmail')['nullable'])
check('Outbox lease shape is constrained',any('LockedBy IS NOT NULL' in x and 'LockedUntilUtc IS NOT NULL' in x for x in by_name['NotificationOutbox']['checks']))
check('Idempotency keys bind actor and operation',['ActorBindingHash','OperationCode','ClientKey'] in by_name['IdempotencyRequests']['unique'])
check('No blanket cascade deletion is introduced','ON DELETE CASCADE' not in sql)
check('Migration has atomic rollback and a dedicated-database guard','SET XACT_ABORT ON' in sql and 'ROLLBACK TRANSACTION' in sql and "N'master'" in sql)
check('Seeds contain no real users or privileged grants','INSERT gp.Users' not in (ROOT/'database/migrations/002_reference_data.sql').read_text(encoding='utf-8') and 'INSERT gp.StaffRoleGrants' not in (ROOT/'database/migrations/002_reference_data.sql').read_text(encoding='utf-8'))
check('At-rest key bytes are not schema fields',not any(c['name'] in ('EncryptionKey','PlaintextToken','RawCredential','Password') for t in TABLES for c in t['columns']))
for t in TABLES:
    check('SQL identifier lengths fit for '+t['name'],all(len('DF_'+t['name']+'_'+c['name'])<=128 for c in t['columns']))
    for c in t['columns']:
        if c['type']=='varbinary(32)':
            check(t['name']+'.'+c['name']+' rejects truncated digests',any(re.search(r'\bDATALENGTH\s*\(\s*'+re.escape(c['name'])+r'\s*\)\s*=\s*32\b',ch,re.I) for ch in t['checks']))
ns={'s':'http://www.w3.org/2000/svg'}
diagrams=list((ROOT/'docs/database/diagrams').glob('*.svg'))
check('Four Chen boards are present',len(diagrams)==4)
for file in diagrams:
    tree=ET.parse(file)
    check(file.stem+' contains entity/relationship/attribute notation',bool(tree.findall('.//s:rect',ns)) and bool(tree.findall('.//s:polygon',ns)) and bool(tree.findall('.//s:ellipse',ns)))
    check(file.stem+' marks primary keys with underlining',any(x.get('text-decoration')=='underline' for x in tree.findall('.//s:text',ns)))
    check(file.stem+' has a matching raster preview',file.with_suffix('.png').exists())

report=dict(status='PASS',scope='Static SQL-derived relational structure and vector checks; not SQL engine execution.',
            table_count=len(by_name),column_count=sum(len(t['columns']) for t in TABLES),foreign_key_count=sum(len(t['fks']) for t in TABLES),
            checks=checks,sql_server_execution=False,
            migration_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'database/migrations').glob('*.sql'))})
out=ROOT/'database/validation/model-report.json'
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(f"PASS: {len(checks)} static checks; {report['table_count']} tables, {report['column_count']} columns, {report['foreign_key_count']} FKs. This checker does not execute SQL; engine evidence is tracked separately.")

