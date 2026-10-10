import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, maskDigits } from '../server/log.js';

test('secrets are redacted from log metadata', () => {
  const out = redact({ password: 'p', token: 't', otpCode: '123456', card6Digits: '123456', userCode: 'u', provider: 'leumi', nested: { id: '012345678' } });
  assert.equal(out.password, '[redacted]');
  assert.equal(out.token, '[redacted]');
  assert.equal(out.otpCode, '[redacted]');
  assert.equal(out.card6Digits, '[redacted]');
  assert.equal(out.userCode, '[redacted]');
  assert.equal(out.nested.id, '[redacted]');
  assert.equal(out.provider, 'leumi');
});

test('long digit runs are masked to the last 4', () => {
  assert.equal(maskDigits('account 12-345-678901 failed'), 'account ****8901 failed');
  assert.equal(maskDigits('card 4580 1234 5678 9012'), 'card ****9012');
  assert.equal(maskDigits('year 2026, amount 150'), 'year 2026, amount 150');
});
