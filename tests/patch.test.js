import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('Max scraper is patched: unknown plan names do not fail the sync', () => {
  const fs = require('node:fs');
  const file = require.resolve('israeli-bank-scrapers-core/lib/scrapers/max.js');
  const src = fs.readFileSync(file, 'utf8');
  assert.ok(src.includes('balancer-patch: unknown plan -> normal'));
  assert.ok(!src.includes('Unknown transaction type ${'));
});
