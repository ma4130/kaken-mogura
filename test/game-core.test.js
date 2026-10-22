import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLE_CENTERS, MoleGame, nearestHole } from '../src/game-core.js';
import { FootZoneDetector } from '../src/foot-zone-detector.js';
import { applyHomography, computeHomography } from '../src/homography.js';

const makeGame = (overrides = {}) => new MoleGame({
  random: () => 0.5,
  config: {
    countdownMs: 100,
    durationMs: 1000,
    firstSpawnDelayMs: 10,
    startVisibleMs: 300,
    endVisibleMs: 300,
    startGapMs: 20,
    endGapMs: 20,
    ...overrides,
  },
});

test('countdown, play, hit and finish form one complete round', () => {
  const game = makeGame();
  game.start(0);
  assert.equal(game.phase, 'countdown');
  game.update(100);
  assert.equal(game.phase, 'running');
  game.update(110);
  assert.ok(game.target);
  const target = game.target;
  const firstHit = game.hit(target.hole, 150, 'test');
  const duplicateHit = game.hit(target.hole, 151, 'test');
  assert.equal(firstHit.type, 'hit');
  assert.equal(firstHit.points, 100);
  assert.equal(duplicateHit.type, 'miss');
  assert.equal(game.score, 100);
  assert.equal(game.hits, 1);
  game.update(1100);
  assert.equal(game.phase, 'ended');
});

test('gold mole awards 300 points', () => {
  const game = new MoleGame({
    random: () => 0,
    config: { countdownMs: 0, durationMs: 1000, firstSpawnDelayMs: 0, goldChance: 1 },
  });
  game.start(0);
  game.update(400);
  assert.equal(game.target.kind, 'gold');
  game.hit(game.target.hole, 450, 'test');
  assert.equal(game.score, 300);
});

test('nearestHole maps known centers and rejects the safe gap', () => {
  assert.equal(HOLE_CENTERS.length, 9);
  assert.equal(nearestHole(0.18, 0.2), 0);
  assert.equal(nearestHole(0.5, 0.5), 4);
  assert.equal(nearestHole(0.82, 0.8), 8);
  assert.equal(nearestHole(0.34, 0.35), null);
});

test('homography maps an oblique camera quadrilateral to field corners', () => {
  const source = [
    { x: 0.2, y: 0.1 },
    { x: 0.9, y: 0.18 },
    { x: 0.82, y: 0.9 },
    { x: 0.12, y: 0.78 },
  ];
  const matrix = computeHomography(source);
  const expected = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  source.forEach((point, index) => {
    const mapped = applyHomography(matrix, point);
    assert.ok(Math.abs(mapped.x - expected[index].x) < 1e-8);
    assert.ok(Math.abs(mapped.y - expected[index].y) < 1e-8);
  });
});

test('homography rejects degenerate calibration points', () => {
  assert.throws(() => computeHomography([
    { x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 0 },
  ]));
});

test('foot detector requires exit and re-entry and deduplicates two feet', () => {
  const detector = new FootZoneDetector({ zoneAt: (point) => point.zone, enterFrames: 2, exitFrames: 2 });
  assert.deepEqual(detector.update([{ key: 'left', zone: null }], 0), []);
  assert.deepEqual(detector.update([{ key: 'left', zone: 2 }], 50), []);
  assert.deepEqual(detector.update([{ key: 'left', zone: 2 }], 100), [2]);
  assert.deepEqual(detector.update([{ key: 'left', zone: 2 }], 150), []);
  detector.update([{ key: 'left', zone: null }], 200);
  detector.update([{ key: 'left', zone: null }], 250);
  detector.update([{ key: 'left', zone: 2 }, { key: 'right', zone: 2 }], 300);
  assert.deepEqual(detector.update([{ key: 'left', zone: 2 }, { key: 'right', zone: 2 }], 350), [2]);
});

test('foot first detected while already on a hole stays blocked until it leaves', () => {
  const detector = new FootZoneDetector({ zoneAt: (point) => point.zone });
  detector.update([{ key: 'left', zone: 4 }], 0);
  assert.deepEqual(detector.update([{ key: 'left', zone: 4 }], 60), []);
  detector.update([{ key: 'left', zone: null }], 120);
  detector.update([{ key: 'left', zone: null }], 180);
  detector.update([{ key: 'left', zone: 4 }], 240);
  assert.deepEqual(detector.update([{ key: 'left', zone: 4 }], 300), [4]);
});

