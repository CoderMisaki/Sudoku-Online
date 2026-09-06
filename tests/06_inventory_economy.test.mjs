import assert from 'assert';

console.log('--- TEST SUITE 6: INVENTORY & ECONOMY ---');

const ITEMS = {
  tool_hoe: { id: 'tool_hoe', name: 'Hoe', cat: 'tool', value: 0 },
  seed_turnip: { id: 'seed_turnip', name: 'Turnip Seeds', cat: 'seed', value: 8 },
  crop_turnip: { id: 'crop_turnip', name: 'Turnip', cat: 'crop', value: 20 },
  berry: { id: 'berry', name: 'Sun Berry', cat: 'forage', value: 12 },
  ore_iron: { id: 'ore_iron', name: 'Iron Ore', cat: 'mineral', value: 26 },
  milk: { id: 'milk', name: 'Milk', cat: 'product', value: 45 },
  butterfly: { id: 'butterfly', name: 'Butterfly', cat: 'insect', value: 18 },
  pie: { id: 'pie', name: 'Berry Pie', cat: 'meal', value: 90, buff: { stam: 40, speed: 0 } },
  furn_bed: { id: 'furn_bed', name: 'Bed', cat: 'furniture', value: 300 },
};

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'tool', label: 'Tools' },
  { id: 'seed', label: 'Seeds' },
  { id: 'crop', label: 'Crops' },
  { id: 'forage', label: 'Forage' },
  { id: 'mineral', label: 'Mining' },
  { id: 'product', label: 'Animal' },
  { id: 'insect', label: 'Insects' },
  { id: 'meal', label: 'Food' },
  { id: 'furniture', label: 'Furniture' },
];

function filterInventory(inv, category) {
  if (category === 'all') return inv;
  return inv.filter(slot => {
    const item = ITEMS[slot.id];
    return item && item.cat === category;
  });
}

// Category filtering
{
  assert.strictEqual(CATEGORIES.length, 10);
  const testInv = [
    { id: 'tool_hoe', qty: 1 },
    { id: 'seed_turnip', qty: 10 },
    { id: 'crop_turnip', qty: 5 },
    { id: 'pie', qty: 2 },
    { id: 'furn_bed', qty: 1 },
  ];

  assert.strictEqual(filterInventory(testInv, 'all').length, 5);
  assert.strictEqual(filterInventory(testInv, 'tool').length, 1);
  assert.strictEqual(filterInventory(testInv, 'tool')[0].id, 'tool_hoe');
  assert.strictEqual(filterInventory(testInv, 'seed').length, 1);
  assert.strictEqual(filterInventory(testInv, 'meal').length, 1);
  assert.strictEqual(filterInventory(testInv, 'furniture').length, 1);
  console.log('✔ Inventory category filtering verified');
}

// 2. Item actions validation
{
  function getAvailableActions(item, qty) {
    const actions = [];
    if (item.cat === 'tool') actions.push('equip');
    if (item.cat === 'meal') actions.push('eat');
    if (item.cat === 'furniture') actions.push('place');
    if (item.cat !== 'tool') {
      if (qty > 1) actions.push('split');
      actions.push('drop');
    }
    return actions;
  }

  const hoeActions = getAvailableActions(ITEMS['tool_hoe'], 1);
  assert(hoeActions.includes('equip'));
  assert(!hoeActions.includes('drop'), 'Tools cannot be dropped');

  const seedActions = getAvailableActions(ITEMS['seed_turnip'], 10);
  assert(seedActions.includes('split'));
  assert(seedActions.includes('drop'));

  const pieActions = getAvailableActions(ITEMS['pie'], 1);
  assert(pieActions.includes('eat'));
  console.log('✔ Item inspector contextual actions validated');
}

// 3. Dynamic economy and atomic transactions
{
  function executeBuy(player, itemId, qty, price) {
    const total = price * qty;
    if (player.gold < total) return { ok: false, error: 'insufficient_gold' };
    if (player.inv.length >= player.invMax) return { ok: false, error: 'inventory_full' };
    player.gold -= total;
    player.inv.push({ id: itemId, qty });
    return { ok: true, gold: player.gold };
  }

  const player = { gold: 100, inv: [], invMax: 2 };

  // Buy 1: succeeds
  const res1 = executeBuy(player, 'seed_turnip', 5, 8); // 40G
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(player.gold, 60);

  // Buy 2: fails due to insufficient gold
  const res2 = executeBuy(player, 'furn_bed', 1, 300);
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.error, 'insufficient_gold');
  assert.strictEqual(player.gold, 60, 'Gold untouched on failure');

  // Buy 3: fill inventory
  const res3 = executeBuy(player, 'berry', 1, 12);
  assert.strictEqual(res3.ok, true);
  assert.strictEqual(player.inv.length, 2);

  // Buy 4: fails due to full inventory
  const res4 = executeBuy(player, 'berry', 1, 12);
  assert.strictEqual(res4.ok, false);
  assert.strictEqual(res4.error, 'inventory_full');
  console.log('✔ Authoritative economy transactions and limits verified');
}

console.log('SUITE 6 PASSED!\n');
