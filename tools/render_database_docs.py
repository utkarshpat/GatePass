"""Render documentation FROM SQL-derived metadata. Never creates or edits DDL."""
from pathlib import Path
import html,json,textwrap
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/database'
manifest=json.loads((ROOT/'database/schema-manifest.json').read_text(encoding='utf-8-sig'))
TABLES=manifest['tables']

def build_dictionary():
    lines = ['# 03 - Data dictionary - GatePass v1.11', '',
        'Derived from the reviewed SQL DDL through Microsoft ScriptDom; descriptive notes do not define schema. Live database verification is tracked separately.', '',
        f"{len(TABLES)} tables including migration history. Each VisitRequests row is one submitted person. No VisitParticipants table or operational Group table.", '',
        'UTC datetime2(3); validity is [start,end). GUID/public references are not authorization. Sensitive means restricted handling, not automatically encrypted. All encrypted-material keys remain outside this database.', '',
        'No ON DELETE CASCADE. Lifecycle cleanup is explicit, audited and ordered; metadata may outlive private photo bytes. Employee email equality, immutable submitted content, permission matrices and cross-row legal transitions require the documented service transactions.', '']
    for i,t in enumerate(TABLES,1):
        lines += [f"## {i:02}. gp.{t['name']}", '', t['purpose'], '',
            '| Column | SQL type | Nullable | Default | Meaning |', '|---|---|---|---|---|']
        for c in t['columns']:
            meaning = c['meaning'] + (' **Restricted.**' if c['sensitive'] else '')
            lines.append(f"| {c['name']} | `{c['type']}` | {'Yes' if c['nullable'] else 'No'} | `{c['default']}` | {meaning} |".replace('`None`','-'))
        lines += ['', '**Primary key:** ' + ', '.join(t['pk']) + '.', '']
        for u in t['unique']:
            lines.append('- Unique: ' + ', '.join(u) + '.')
        for f in t['fks']:
            lines.append('- FK: ('+', '.join(f['columns'])+') -> '+f['target']+' ('+', '.join(f['target_columns'])+').')
        for ch in t['checks']:
            lines.append('- Check: `'+ch+'`.')
        for ix in t['indexes']:
            lines.append('- Index: `'+ix+'`')
        lines.append('')
    return '\n'.join(lines)

def build_diagrams():
    """Traditional Chen notation: rectangles, diamonds, ovals, underlined PKs.

    Each row is independent and left-to-right. Repeated rectangles reference the
    same table. The dictionary and DDL include the complete physical FK list.
    """
    diagrams = [
      ('02A_Organization_and_Authorization', 'ORGANIZATION & AUTHORIZATION', [
        ('Locations','LocationId','LocationCode','CONTAINS','1','N','ProjectLocations','ProjectLocationId','LocationId / ProjectId','MAPS','N','1','Projects','ProjectId','ExternalProjectCode'),
        ('Employees','EmployeeId','OfficialEmail','HAS','1','N','EmployeeProjectMemberships','EmployeeId + ProjectId','IsActive / VerifiedAtUtc','BELONGS TO','N','1','Projects','ProjectId','IsActive'),
        ('Users','UserId','IdentitySubject','HOLDS','1','N','StaffRoleGrants','RoleGrantId','RoleCode / ScopeType','CARRIES','1','N','GrantCapabilities','RoleGrantId + CapabilityCode','Explicit permission'),
        ('Capabilities','CapabilityCode','Description','ALLOWS','1','N','GrantCapabilities','RoleGrantId + CapabilityCode','No implicit superuser'),
        ('Users','UserId','AuthorizationVersion','ALLOCATED','1','N','GuardAssignments','GuardAssignmentId','ValidFrom / ValidUntil','COVERS','N','1','ProjectLocations','ProjectLocationId','LocationId / ProjectId'),
        ('Users','UserId','IsActive','MAY LINK','0..1','0..1','Employees','EmployeeId','LastSyncedAtUtc'),
      ], 'A role needs explicit capabilities. Project guards also need an active exact project-location allocation. Scope FKs are detailed in the dictionary.'),
      ('02B_Registration_and_Individual_Visits', 'REGISTRATION & INDIVIDUAL VISITS', [
        ('RegistrationIntakes','IntakeId','TokenHash / ExpiresAtUtc','SUBMITS','1','N','VisitRequests','VisitRequestId','One person per row','TARGETS','N','0..1','ProjectLocations','ProjectLocationId','Absent for TEMP_ID'),
        ('RegistrationIntakes','IntakeId','PUBLIC / EMPLOYEE','OWNS','1','N','PhotoAssets','PhotoAssetId','Private StorageKey','USED BY','1','0..1','VisitRequests','VisitRequestId','One distinct photo asset'),
        ('VisitRequests','VisitRequestId','SnapshotVersion / Hash','HAS DECISION','1','0..1','ApprovalDecisions','VisitRequestId','Decision / Source','MADE BY','N','1','Employees','EmployeeId','Current project membership'),
        ('Employees','EmployeeId','OfficialEmail','USES SLOT','1','N','TemporaryIdSlots','EmployeeId + LocationId + Date','One TEMP_ID per local day','POINTS TO','0..1','1','VisitRequests','VisitRequestId','Individual TEMP_ID'),
      ], 'Grouping stops at submission. Every final visit has its own approval/status, card, staff-list row and movements. No operational group counts.'),
      ('02C_Credentials_and_Movements', 'CREDENTIALS & INDIVIDUAL MOVEMENTS', [
        ('VisitRequests','VisitRequestId','Status / UTC window','ISSUED','1','N','AccessPasses','AccessPassId','Version / CredentialHash','ENCRYPTED AS','1','0..1','PassSecrets','AccessPassId','Ciphertext / KeyVersion'),
        ('VisitRequests','VisitRequestId','One person','HAS STATE','1','1','VisitPresence','VisitRequestId','IsInside / LastEvent','LAST EVENT','1','0..1','AccessEvents','AccessEventId','Same individual visit'),
        ('AccessPasses','AccessPassId','One current per visit','RECORDS','1','N','AccessEvents','AccessEventId','ENTRY / EXIT','RECORDED BY','N','1','Users','UserId','Effective capability'),
        ('AccessPasses','AccessPassId','Historical pass retained','VERIFIED IN','0..1','N','PassScanAttempts','ScanAttemptId','OutcomeCode','PERFORMED BY','N','1','Users','UserId','Authorized scanner'),
        ('AccessPasses','AccessPassId','Static QR / online check','PRINTED VIA','1','N','PassPrintJobs','PrintJobId','Render / dispatch state','REQUESTED BY','N','1','Users','UserId','Reception scope'),
      ], 'Scan is not entry. Reissue preserves visit presence. Old/expired credentials cannot grant entry; an authorized reconciled EXIT can close an occupant.'),
      ('02D_Delivery_and_Operations', 'DELIVERY, RETRIES & OPERATIONS', [
        ('AccessPasses','AccessPassId','Specific credential version','DELIVERED VIA','1','N','PassDeliveryLinks','DeliveryLinkId','Hash + encrypted token','REFERENCED BY','0..1','N','NotificationOutbox','NotificationId','Lease / retry / dedupe'),
        ('VisitRequests','VisitRequestId','Individual request','QUEUES','0..1','N','NotificationOutbox','NotificationId','No raw bearer secrets'),
        ('IdempotencyRequests','OperationId','Actor + operation + payload','BINDS','1','0..1','AccessEvents','AccessEventId','Unique OperationId'),
        ('Users','UserId','Current authorization','OWNS','1','N','Sessions','SessionHash','Idle / absolute expiry'),
        ('Users','UserId','Null for system actor','MAY TRIGGER','0..1','N','SecurityAuditEvents','AuditEventId','Append-only + SIEM export'),
      ], 'SchemaMigrations is operational bookkeeping. Diagrams show significant relationships; dictionary and SQL enumerate all physical FKs and constraints.'),
    ]
    out = DOC/'diagrams'
    out.mkdir(parents=True,exist_ok=True)
    actual_tables={t['name']:t for t in TABLES}
    attribute_hints={
      'Locations':['LocationCode'], 'Projects':['ExternalProjectCode','IsActive'],
      'ProjectLocations':['ProjectId','LocationId'], 'Users':['IdentitySubject','AuthorizationVersion'],
      'Employees':['OfficialEmail','IsActive'], 'EmployeeProjectMemberships':['IsActive','VerifiedAtUtc'],
      'StaffRoleGrants':['RoleCode','ScopeType'], 'GrantCapabilities':[], 'Capabilities':['Description'],
      'GuardAssignments':['ValidFromUtc','ValidUntilUtc'], 'RegistrationIntakes':['Status','ExpiresAtUtc'],
      'PhotoAssets':['StorageKey','MimeType'], 'VisitRequests':['RequestType','Status'],
      'TemporaryIdSlots':['VisitRequestId'], 'ApprovalDecisions':['Decision','DecisionSource'],
      'AccessPasses':['PassVersion','Status'], 'PassSecrets':['KeyVersion'],
      'VisitPresence':['IsInside','LastMovementAtUtc'], 'AccessEvents':['EventType','OccurredAtUtc'],
      'PassScanAttempts':['OutcomeCode'], 'PassPrintJobs':['PrintReason','Status'],
      'PassDeliveryLinks':['ExpiresAtUtc','RevokedAtUtc'], 'NotificationOutbox':['Status','LockedUntilUtc'],
      'IdempotencyRequests':['OperationCode','PayloadHash'], 'Sessions':['IdleExpiresAtUtc','AbsoluteExpiresAtUtc'],
      'SecurityAuditEvents':['ActionCode','ResultCode'],
    }
    for code,title,rows,note in diagrams:
        h=260+len(rows)*230
        pieces=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="{h}" viewBox="0 0 1800 {h}">',
          '<rect width="1800" height="100%" fill="#ffffff"/>',
          '<rect width="1800" height="8" fill="#FF7800"/>']
        def text(x,y,value,size=18,bold=False,underline=False,anchor='middle',color='#182230',max_chars=None):
            wrap=textwrap.wrap(value,max_chars or (30 if size>=17 else 38)) or ['']
            for j,line in enumerate(wrap):
                pieces.append(f'<text x="{x}" y="{y+j*(size+4)}" text-anchor="{anchor}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{"700" if bold else "400"}" fill="{color}" text-decoration="{"underline" if underline else "none"}">{html.escape(line)}</text>')
        text(48,58,code[:3]+' | CHEN ER - '+title,24,True,anchor='start',max_chars=110)
        text(48,100,'READ LEFT TO RIGHT | Rectangle = Entity | Diamond = Relationship | Oval = Attribute | Underlined PK | 1/N = cardinality',14,anchor='start',color='#667085',max_chars=180)
        def entity(x,y,name,key,attribute,num):
            # Actual physical attributes only: explanations belong in notes,
            # and composite keys use one underlined oval per component.
            model=actual_tables[name]
            keys=model['pk']
            attributes=attribute_hints[name]
            assert all(a in {c['name'] for c in model['columns']} for a in attributes)
            for offset,fields,is_key in [(-87,keys,True),(87,attributes,False)]:
                n=len(fields)
                for j,field in enumerate(fields):
                    fx=x+(j-(n-1)/2)*(310/n)
                    rx=min(153,148/n)
                    cy=y+offset
                    end=cy+(27 if is_key else -27)
                    start=y+(-31 if is_key else 31)
                    pieces.append(f'<line x1="{x}" y1="{start}" x2="{fx}" y2="{end}" stroke="#98A2B3" stroke-width="2"/>')
                    pieces.append(f'<ellipse cx="{fx}" cy="{cy}" rx="{rx}" ry="27" fill="#F0F5FA" stroke="#98B4CF" stroke-width="1.5"/>')
                    text(fx,cy+4,field,14 if n==1 else (11 if n==2 else 9),underline=is_key,max_chars=40)
                    if is_key:
                        text(fx+rx-1,cy-24,'PK',9,True,color='#C9002B')
            pieces.append(f'<rect x="{x-158}" y="{y-31}" width="316" height="62" fill="#FFF8F5" stroke="#C9002B" stroke-width="2"/>')
            text(x-146,y-17,f'E{num:02}',10,True,anchor='start',color='#C9002B')
            text(x,y-2,name,17,True)
        def relation(x,y,label,left,right):
            pieces.append(f'<line x1="{x-134}" y1="{y}" x2="{x-82}" y2="{y}" stroke="#7D8C9E" stroke-width="2"/>')
            pieces.append(f'<line x1="{x+82}" y1="{y}" x2="{x+134}" y2="{y}" stroke="#7D8C9E" stroke-width="2"/>')
            pieces.append(f'<polygon points="{x-82},{y} {x},{y-43} {x+82},{y} {x},{y+43}" fill="#FFF1E8" stroke="#FF7800" stroke-width="2"/>')
            text(x,y-3,label,13,True)
            text(x-112,y-14,left,15,True,color='#315F90')
            text(x+112,y-14,right,15,True,color='#315F90')
        for i,r in enumerate(rows):
            y=270+i*230
            entity(225,y,r[0],r[1],r[2],i*3+1)
            relation(517,y,r[3],r[4],r[5])
            entity(809,y,r[6],r[7],r[8],i*3+2)
            if len(r)>9:
                relation(1101,y,r[9],r[10],r[11])
                entity(1393,y,r[12],r[13],r[14],i*3+3)
        # Footer grows to accommodate explanatory text without shrinking the diagrams.
        pieces.append(f'<rect x="36" y="{h-59}" width="1728" height="43" rx="5" fill="#F7F8FA"/>')
        for i,line in enumerate(textwrap.wrap(note,178)):
            pieces.append(f'<text x="52" y="{h-41+i*16}" font-family="Arial, sans-serif" font-size="13" fill="#667085">{html.escape(line)}</text>')
        pieces.append('</svg>')
        svg='\n'.join(pieces)
        ET.fromstring(svg)
        (out/(code+'.svg')).write_text(svg,encoding='utf-8')

if __name__=='__main__':
    DOC.mkdir(parents=True,exist_ok=True)
    (DOC/'03_Data_Dictionary.md').write_text(build_dictionary(),encoding='utf-8',newline='\n')
    build_diagrams()
    print('Rendered dictionary and Chen views from SQL-derived metadata; SQL files unchanged.')
