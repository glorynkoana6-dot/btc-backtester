
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  features,
  simulate,
  randomParam,
  research
} from './engine.js';

const bars = Array.from({ length: 500 }, (_, i) => {
  const c = 100 + i * .03 + Math.sin(i / 5);

  return {
    t: 1700000000 + i * 300,
    o: c - .1,
    h: c + .5,
    l: c - .5,
    c,
    v: 10
  };
});

test('feature count', () => {
  assert.equal(features(bars).length, 500);
});

test('simulation finite', () => {
  assert.ok(Number.isFinite(simulate(bars, randomParam()).equity));
});

test('research returns candidate', () => {
  assert.ok(research(bars, 1, 8).champion);
});
