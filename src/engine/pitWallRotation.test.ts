import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePitWallPlan,
  applyManualRotationEdit,
  getNextUpcomingSub,
} from './pitWallRotation';
import type { MinimalPlayer } from '../tacticsData';

function makeRoster(): MinimalPlayer[] {
  return [
    { id: 'p1', name: 'سعد الحارس', primaryPos: 'حارس مرمى', availableStatus: 'available' },
    { id: 'p2', name: 'خالد دفاع', primaryPos: 'مدافع', availableStatus: 'available' },
    { id: 'p3', name: 'فهد دفاع', primaryPos: 'مدافع', availableStatus: 'available' },
    { id: 'p4', name: 'عمر وسط', primaryPos: 'وسط', availableStatus: 'available' },
    { id: 'p5', name: 'تركي وسط', primaryPos: 'وسط', availableStatus: 'available' },
    { id: 'p6', name: 'نايف هجوم', primaryPos: 'مهاجم', availableStatus: 'available' },
    { id: 'p7', name: 'بدر احتياط 1', primaryPos: 'وسط', availableStatus: 'available' },
    { id: 'p8', name: 'راشد احتياط 2', primaryPos: 'مهاجم', availableStatus: 'available' },
    { id: 'p9', name: 'سلطان غائب', primaryPos: 'مدافع', availableStatus: 'unavailable' },
  ];
}

test('generatePitWallPlan excludes unavailable players and builds fair 6v6 rotation schedule', () => {
  const plan = generatePitWallPlan(makeRoster(), {
    matchMinutes: 60,
    startersCount: 6,
    style: 'high_press',
  });

  assert.equal(plan.starters.length, 6);
  assert.equal(plan.bench.length, 2);
  assert.equal(plan.excluded.length, 1);
  assert.equal(plan.excluded[0].id, 'p9');

  // Ensure unavailable player never appears in events or starters/bench
  assert.ok(!plan.starters.some((p) => p.id === 'p9'));
  assert.ok(!plan.bench.some((p) => p.id === 'p9'));
  assert.ok(plan.events.length >= 4);

  // Every available bench player must receive meaningful minutes
  for (const b of plan.bench) {
    assert.ok(b.plannedMinutes >= 20, `Expected bench player ${b.name} to play >= 20m, got ${b.plannedMinutes}`);
  }
  assert.ok(plan.fairnessSpreadMin <= 18, `Fairness spread too wide: ${plan.fairnessSpreadMin}m`);
  assert.ok(plan.disclaimerAr.includes('ليس قياساً فسيولوجياً'));
});

test('fatigue curve rises during playing stints and recovers during bench rest', () => {
  const plan = generatePitWallPlan(makeRoster(), {
    matchMinutes: 50,
    startersCount: 6,
    style: 'high_press',
  });

  // Pick a bench player who rests first then plays, or a starter who plays then rests
  const starterOutfield = plan.fatigueTracks.find((t) => !t.isGk && t.points.some((pt) => !pt.onPitch));
  assert.ok(starterOutfield, 'Expected at least one outfield player with both pitch and bench segments');

  let sawPitchIncrease = false;
  let sawBenchRecovery = false;
  for (let i = 1; i < starterOutfield.points.length; i++) {
    const prev = starterOutfield.points[i - 1];
    const curr = starterOutfield.points[i];
    if (curr.onPitch && curr.fatiguePct > prev.fatiguePct) sawPitchIncrease = true;
    if (!curr.onPitch && curr.fatiguePct < prev.fatiguePct) sawBenchRecovery = true;
  }
  assert.equal(sawPitchIncrease, true);
  assert.equal(sawBenchRecovery, true);
});

test('applyManualRotationEdit updates schedule and recalculates minutes cleanly', () => {
  const plan = generatePitWallPlan(makeRoster(), {
    matchMinutes: 60,
    startersCount: 6,
    style: 'balanced',
  });
  const firstEvent = plan.events[0];
  assert.ok(firstEvent);

  const edited = applyManualRotationEdit(plan, firstEvent.id, {
    minute: firstEvent.minute + 3,
  });
  const updatedEvent = edited.events.find((e) => e.id === firstEvent.id);
  assert.ok(updatedEvent);
  assert.equal(updatedEvent.minute, firstEvent.minute + 3);

  const next = getNextUpcomingSub(edited, 0);
  assert.ok(next);
  assert.equal(next.event.id, edited.events[0].id);
});
