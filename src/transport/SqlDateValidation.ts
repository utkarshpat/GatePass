/** Validation is total: malformed, out-of-range and non-date values return false,
 * rather than throwing RangeError before an INVALID_SQL_PARAMETER can be raised.
 */
export function isCanonicalSqlTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) || value.startsWith('0000-')) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}
export function isCanonicalSqlDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/u.test(value) || value.startsWith('0000-')) return false;
  const millis = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
}
