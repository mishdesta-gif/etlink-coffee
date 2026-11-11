import test from 'node:test';
import assert from 'node:assert/strict';
import { outstandingAmount } from '../src/lib/trading/money.ts';

test('commission balances preserve exact decimal precision and large ledger values',()=>{
  for (const [amount,paid,expected] of [
    ['0.300000','0.100000','0.2'],['350.000000','100','250'],['337.500000','337.500000','0'],
    ['999999999999999999.999999','0.000001','999999999999999999.999998'],
  ]) assert.equal(outstandingAmount(amount,paid),expected);
});
test('invalid or overpaid ledger balances fail closed',()=>{
  for (const [amount,paid] of [['1','2'],['NaN','0'],['1e10','0'],['-1','0'],['1.0000001','0']]) {
    assert.throws(()=>outstandingAmount(amount,paid));
  }
});
