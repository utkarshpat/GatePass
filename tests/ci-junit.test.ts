import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNodeJUnit } from '../tools/ci/node-junit.mjs';

test('Azure JUnit normalization preserves passed, failed and skipped case details', () => {
  const cases = '<testcase name="pass"/><testcase name="failure"><failure message="a &lt; b">stack</failure></testcase><testcase name="skip"><skipped message="platform"/></testcase>';
  const result = normalizeNodeJUnit('<?xml version="1.0"?><testsuites>' + cases + '</testsuites>');
  assert.equal(result, '<?xml version="1.0"?><testsuites><testsuite name="Node unit and contract tests" tests="3" failures="1" skipped="1">' + cases + '</testsuite></testsuites>');
});

test('Azure JUnit normalization rejects missing or empty reports', () => {
  assert.throws(() => normalizeNodeJUnit(''), /INVALID_NODE_JUNIT_REPORT/u);
  assert.throws(() => normalizeNodeJUnit('<testsuites></testsuites>'), /EMPTY_NODE_JUNIT_REPORT/u);
});
