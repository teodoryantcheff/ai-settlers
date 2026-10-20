const test = require('node:test');
const assert = require('node:assert/strict');
const { goodsIn, inventoryEntries } = require('../src/core/inventory.ts');

test('an inventory lists its goods in the order they were added, as simulation scheduling relies on', () => {
  const stock = { planks: 2, logs: 0 };
  stock.bread = 5;
  assert.deepEqual(goodsIn(stock), ['planks', 'logs', 'bread']);
  assert.deepEqual(inventoryEntries(stock), [
    ['planks', 2],
    ['logs', 0],
    ['bread', 5],
  ]);
  assert.deepEqual(goodsIn({}), []);
});
