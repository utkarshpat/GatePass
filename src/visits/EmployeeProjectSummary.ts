export type EmployeeProjectSummary = { available: boolean; total: number | null; items: { name: string }[] };
/** Display-only membership metadata. It never grants project entry. */
export function employeeProjectSummary(value: unknown): EmployeeProjectSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.available !== 'boolean' || !Array.isArray(v.items) || v.items.length > 3) return null;
  if (!v.available) return v.total === null && v.items.length === 0 ? { available: false, total: null, items: [] } : null;
  if (!Number.isSafeInteger(v.total) || Number(v.total) < 0 || v.items.length !== Math.min(3, Number(v.total))) return null;
  for (const item of v.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || !item.name.isWellFormed()) return null;
    // Different projects may share a display name; preserve their honest count.
  }
  return { available: true, total: Number(v.total), items: v.items.map(item => ({ name: item.name })) };
}
