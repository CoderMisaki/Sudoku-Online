import { execSync } from 'child_process';

console.log('===============================================================');
console.log('  RUNNING COMPLETE HARVEST MOON FULL-STACK TEST SUITES');
console.log('===============================================================\n');

const testFiles = [
  'tests/01_orientation_gate.test.mjs',
  'tests/02_input_manager.test.mjs',
  'tests/03_movement_prediction_interp.test.mjs',
  'tests/04_world_map.test.mjs',
  'tests/05_chat_system.test.mjs',
  'tests/06_inventory_economy.test.mjs',
  'tests/07_persistence_reconnect.test.mjs',
  'tests/08_mobile_lifecycle_reconnect.test.mjs',
  '.jules/harvest-test-suite.mjs',
];

let totalPassed = 0;

for (const file of testFiles) {
  try {
    const output = execSync(`node ${file}`, { encoding: 'utf8' });
    console.log(output);
    totalPassed++;
  } catch (err) {
    console.error(`❌ FAILED: ${file}`);
    console.error(err.stdout || err.message);
    process.exit(1);
  }
}

console.log('===============================================================');
console.log(`  ALL ${totalPassed} TEST SUITES PASSED SUCCESSFULLY! (0 Failures)`);
console.log('===============================================================\n');
