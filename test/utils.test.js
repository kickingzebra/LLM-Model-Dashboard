const test = require('node:test');
const assert = require('node:assert/strict');

const { toIsoTimestamp, formatBytes } = require('../src/utils');

// --- toIsoTimestamp ---

test('toIsoTimestamp converts compact timestamp to ISO format', () => {
  assert.equal(toIsoTimestamp('20260414T103000'), '2026-04-14T10:30:00Z');
});

test('toIsoTimestamp converts compact timestamp with trailing Z', () => {
  assert.equal(toIsoTimestamp('20260415T191500Z'), '2026-04-15T19:15:00Z');
});

test('toIsoTimestamp passes through a valid ISO string', () => {
  assert.equal(toIsoTimestamp('2026-04-14T17:30:00Z'), '2026-04-14T17:30:00Z');
});

test('toIsoTimestamp returns null for null input', () => {
  assert.equal(toIsoTimestamp(null), null);
});

test('toIsoTimestamp returns null for undefined input', () => {
  assert.equal(toIsoTimestamp(undefined), null);
});

test('toIsoTimestamp returns null for empty string', () => {
  assert.equal(toIsoTimestamp(''), null);
});

test('toIsoTimestamp returns null for non-string input', () => {
  assert.equal(toIsoTimestamp(42), null);
});

test('toIsoTimestamp returns null for unparseable string', () => {
  assert.equal(toIsoTimestamp('not-a-date'), null);
});

// --- formatBytes ---

test('formatBytes returns 0 B for zero', () => {
  assert.equal(formatBytes(0), '0 B');
});

test('formatBytes returns 0 B for negative values', () => {
  assert.equal(formatBytes(-100), '0 B');
});

test('formatBytes returns 0 B for null', () => {
  assert.equal(formatBytes(null), '0 B');
});

test('formatBytes formats plain bytes', () => {
  assert.equal(formatBytes(512), '512 B');
});

test('formatBytes formats kilobytes', () => {
  assert.equal(formatBytes(1024), '1 KB');
});

test('formatBytes formats megabytes with one decimal', () => {
  assert.equal(formatBytes(1536 * 1024), '1.5 MB');
});

test('formatBytes formats gigabytes with one decimal', () => {
  assert.equal(formatBytes(4.2 * 1024 * 1024 * 1024), '4.2 GB');
});
