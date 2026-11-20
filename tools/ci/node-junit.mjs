export function normalizeNodeJUnit(report) {
  if (!report.includes('<testsuites>') || !report.includes('</testsuites>')) {
    throw new Error('INVALID_NODE_JUNIT_REPORT');
  }
  const tests = (report.match(/<testcase\b/gu) ?? []).length;
  if (tests === 0) throw new Error('EMPTY_NODE_JUNIT_REPORT');
  const failures = (report.match(/<failure\b/gu) ?? []).length;
  const skipped = (report.match(/<skipped\b/gu) ?? []).length;
  // Node emits top-level testcases under testsuites. Azure requires a testsuite.
  return report
    .replace('<testsuites>', `<testsuites><testsuite name="Node unit and contract tests" tests="${tests}" failures="${failures}" skipped="${skipped}">`)
    .replace('</testsuites>', '</testsuite></testsuites>');
}
