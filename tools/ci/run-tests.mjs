import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('output/test-results', { recursive: true });
mkdirSync('output/coverage', { recursive: true });
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=4', '--experimental-test-coverage',
  '--test-coverage-include=src/**/*.ts', '--test-coverage-include-all',
  '--test-coverage-lines=90', '--test-coverage-branches=80', '--test-coverage-functions=90',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=junit', '--test-reporter-destination=output/test-results/unit.xml',
  '--test-reporter=lcov', '--test-reporter-destination=output/coverage/lcov.info',
  'tests/*.test.ts'
], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
