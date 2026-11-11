const assert = require('node:assert/strict');

// Archived scores can cross JS/V8 versions, whose Math functions may differ
// in their final binary digits. Keep structure and integer choices exact;
// allow only a few machine epsilons for floating-point values.
const FLOAT_EPSILONS = 8;
function assertSavedScoreEqual(actual, expected, location = 'score') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    const tolerance = FLOAT_EPSILONS * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
    assert.ok(Number.isFinite(actual) && Number.isFinite(expected)
      && !(Number.isInteger(actual) && Number.isInteger(expected))
      && Math.abs(actual - expected) <= tolerance,
      `${location}: ${actual} differs from ${expected}`);
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.equal(Array.isArray(actual), Array.isArray(expected), location);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), location);
    for (const key of Object.keys(expected)) assertSavedScoreEqual(actual[key], expected[key], `${location}.${key}`);
    return;
  }
  assert.deepEqual(actual, expected, location);
}
module.exports = { assertSavedScoreEqual, FLOAT_EPSILONS };
