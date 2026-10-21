"""Read-only comparison of a captured SQL Server catalog with SQL-derived metadata.

Never creates DDL, modifies the database or treats diagrams as schema authority.
This checks the declared structural scope, not CHECK expression equivalence,
collation, index sort/include semantics, identity seeds, grants or transactions.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("catalog", type=Path)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((ROOT / "database/schema-manifest.json").read_text(encoding="utf-8-sig"))
catalog_bytes = args.catalog.read_bytes()
catalog = json.loads(catalog_bytes.decode("utf-8-sig"))
checks = []


def check(label, matches):
    checks.append({"check": label, "passed": bool(matches)})


def live_type(column):
    name = column["sql_type"]
    if name == "timestamp":
        return "rowversion"
    if name in {"nvarchar", "nchar", "varchar", "char", "varbinary", "binary"}:
        length = column["max_length"]
        if name.startswith("n") and length != -1:
            length //= 2
        return f"{name}({'max' if length == -1 else length})"
    if name in {"datetime2", "datetimeoffset", "time"}:
        return f"{name}({column['scale']})"
    if name in {"decimal", "numeric"}:
        return f"{name}({column['precision']},{column['scale']})"
    return name


def defaults_equal(expected, observed):
    if expected is None or observed is None:
        return expected is observed
    # The baseline only uses literal defaults and parameterless built-ins.
    # Normalize redundant parentheses only for those simple forms.
    compact = lambda s: re.sub(r"\s+", "", s).lower()
    left, right = compact(expected), compact(observed)
    for _ in range(5):
        if left.startswith("(") and left.endswith(")"):
            left = left[1:-1]
        if right.startswith("(") and right.endswith(")"):
            right = right[1:-1]
    return left == right


source_path = ROOT / manifest["source"]["path"]
check("SQL-derived manifest source checksum", hashlib.sha256(source_path.read_bytes()).hexdigest() == manifest["source"]["sha256"])
expected_tables = {t["name"]: t for t in manifest["tables"]}
actual_tables = {t["table_name"]: t for t in catalog["tables"]}
check("Exact gp table set", set(actual_tables) == set(expected_tables))
for name, expected in expected_tables.items():
    if name not in actual_tables:
        continue
    actual = actual_tables[name]
    check(f"{name}: schema", actual["schema_name"] == "gp")
    check(f"{name}: ordered column set", [c["name"] for c in actual["columns"]] == [c["name"] for c in expected["columns"]])
    actual_columns = {c["name"]: c for c in actual["columns"]}
    for column in expected["columns"]:
        label = f"{name}.{column['name']}"
        if column["name"] not in actual_columns:
            continue
        observed = actual_columns[column["name"]]
        expected_type = re.sub(r" IDENTITY\(.*\)$", "", column["type"]).lower()
        check(label + ": type/size", expected_type == live_type(observed))
        check(label + ": nullability", column["nullable"] == observed["is_nullable"])
        check(label + ": identity presence", (" IDENTITY(" in column["type"]) == observed["is_identity"])
        check(label + ": default", defaults_equal(column["default"], observed.get("default_definition")))
    key_columns = lambda i: tuple(c["name"] for c in sorted(i["columns"], key=lambda c: c["key_ordinal"]) if c["key_ordinal"] > 0)
    primary = [key_columns(i) for i in actual["indexes"] if i["is_primary_key"]]
    unique = {key_columns(i) for i in actual["indexes"] if i["name"].startswith("UQ_")}
    check(f"{name}: primary key", primary == [tuple(expected["pk"])])
    check(f"{name}: unique key columns", unique == {tuple(k) for k in expected["unique"]})
    expected_fks = {(tuple(f["columns"]), "gp", f["target"], tuple(f["target_columns"])) for f in expected["fks"]}
    actual_fks = {(tuple(c["parent_column"] for c in f["columns"]), f["target_schema"], f["target_table"], tuple(c["target_column"] for c in f["columns"])) for f in actual.get("foreign_keys", [])}
    check(f"{name}: foreign key mappings", expected_fks == actual_fks)
    check(f"{name}: CHECK count", len(expected["checks"]) == len(actual.get("checks", [])))
    for constraint in actual.get("checks", []) + actual.get("foreign_keys", []):
        check(f"{name}.{constraint['name']}: enabled/trusted", not constraint["is_disabled"] and not constraint["is_not_trusted"])
    expected_indexes = {re.search(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(\w+)", text, re.I).group(1) for text in expected["indexes"]}
    actual_indexes = {i["name"] for i in actual["indexes"] if not i["is_primary_key"] and not i["name"].startswith("UQ_")}
    check(f"{name}: explicit index names", expected_indexes == actual_indexes)

report = {
    "status": "PASS" if all(c["passed"] for c in checks) else "FAIL",
    "database": catalog["database_name"],
    "sql_server_version": catalog["sql_server_version"],
    "inspected_at_utc": catalog["inspected_at_utc"],
    "catalog_sha256": hashlib.sha256(catalog_bytes).hexdigest(),
    "baseline_sha256": manifest["source"]["sha256"],
    "schema_source_hashes": manifest["source"].get("schema_sources", []),
    "checks_passed": sum(c["passed"] for c in checks),
    "checks_total": len(checks),
    "scope": "Table/ordered column sets, type/size, nullability, identity presence, simple defaults, PK/unique keys, FK mappings, CHECK counts, enabled/trusted constraints, explicit index names.",
    "limits": "No CHECK expression equivalence, collations, index sort/include/filter equivalence, identity seeds, role/grant, workflow or concurrency proof.",
    "checks": checks,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(f"Live catalog comparison: {report['checks_passed']}/{len(checks)} checks {report['status']}")
for result in checks:
    if not result["passed"]:
        print("FAIL: " + result["check"])
raise SystemExit(0 if report["status"] == "PASS" else 1)
