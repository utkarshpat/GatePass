import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isCanonicalSqlDate,isCanonicalSqlTimestamp} from '../src/transport/SqlDateValidation.ts';

test('valid SQL date/timestamp formats remain valid',()=>{
 assert.equal(isCanonicalSqlDate('2024-02-29'),true);
 assert.equal(isCanonicalSqlDate('2026-10-20'),true);
 assert.equal(isCanonicalSqlTimestamp('2026-10-20T00:00:00.000Z'),true);
 for(const date of ['0001-01-01','0099-12-31','2000-02-29','9999-12-31']){assert.equal(isCanonicalSqlDate(date),true);assert.equal(isCanonicalSqlTimestamp(date+'T23:59:59.999Z'),true);}
});
test('invalid dates never throw RangeError and fail closed',()=>{
 for(const value of ['0000-01-01','2026-00-01','2026-01-00','2026-99-99','2026-13-01','2026-02-30','2025-02-29','1900-02-29','9999-99-99','10000-01-01','NaN',null,1234,{},[],Symbol('invalid'),1n,'2026-10-20T00:00:00Z']){
  assert.doesNotThrow(()=>isCanonicalSqlDate(value));
  assert.equal(isCanonicalSqlDate(value),false);
 }
 for(const value of ['0000-01-01T00:00:00.000Z','2026-99-99T00:00:00.000Z','2026-10-20T25:00:00.000Z','2026-10-20T24:00:00.000Z','2026-10-20T00:60:00.000Z','2026-10-20T00:00:60.000Z','2026-02-30T00:00:00.000Z','2026-10-20',null,1,{},Symbol('invalid'),1n]){
  assert.doesNotThrow(()=>isCanonicalSqlTimestamp(value));
  assert.equal(isCanonicalSqlTimestamp(value),false);
 }
});
