import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATIONS_CATALOG,
  PITCH_SIZE_META,
  TACTICAL_SCENARIOS_10,
  getFormationPhaseSequence,
  getRoleSpotlightSequence,
  splitFairTeams,
  suggestSmartLineup,
  computeTeamChemistry,
  buildRotationPlan,
  type MinimalPlayer,
} from './tacticsData';

const SAMPLE_SQUAD: MinimalPlayer[] = [
  { id: 'p1', name: 'طارق الحارس', primaryPos: 'حارس مرمى', availableStatus: 'available', skills: { speed: 6, shooting: 4, passing: 7, dribbling: 5, defending: 8, stamina: 7, vision: 7, teamwork: 8, control: 7, positioning: 9 } },
  { id: 'p2', name: 'عمر الصخرة', primaryPos: 'مدافع', availableStatus: 'available', skills: { speed: 7, shooting: 5, passing: 7, dribbling: 6, defending: 9, stamina: 8, vision: 7, teamwork: 8, control: 7, positioning: 8 } },
  { id: 'p3', name: 'سامي القائد', primaryPos: 'مدافع', availableStatus: 'available', skills: { speed: 7, shooting: 6, passing: 8, dribbling: 6, defending: 8, stamina: 8, vision: 8, teamwork: 9, control: 7, positioning: 8 } },
  { id: 'p4', name: 'يمان المايسترو', primaryPos: 'لاعب وسط', availableStatus: 'available', skills: { speed: 7, shooting: 7, passing: 9, dribbling: 8, defending: 6, stamina: 8, vision: 9, teamwork: 9, control: 8, positioning: 7 } },
  { id: 'p5', name: 'زيد السريع', primaryPos: 'جناح', availableStatus: 'available', skills: { speed: 9, shooting: 7, passing: 7, dribbling: 9, defending: 5, stamina: 8, vision: 7, teamwork: 8, control: 8, positioning: 7 } },
  { id: 'p6', name: 'خالد الهدّاف', primaryPos: 'مهاجم', availableStatus: 'available', skills: { speed: 8, shooting: 9, passing: 7, dribbling: 8, defending: 4, stamina: 7, vision: 7, teamwork: 7, control: 8, positioning: 9 } },
  { id: 'p7', name: 'مصاب غير متاح', primaryPos: 'مهاجم', availableStatus: 'unavailable', skills: { speed: 10, shooting: 10, passing: 10, dribbling: 10, defending: 10, stamina: 10, vision: 10, teamwork: 10, control: 10, positioning: 10 } },
  { id: 'p8', name: 'فهد البديل', primaryPos: 'لاعب وسط', availableStatus: 'available', skills: { speed: 7, shooting: 6, passing: 7, dribbling: 7, defending: 6, stamina: 8, vision: 7, teamwork: 8, control: 7, positioning: 7 } },
];

test('All pitch sizes (5v5, 6v6, 7v7, 11v11) contain exact required formations and offside rules', () => {
  assert.equal(PITCH_SIZE_META['5v5'].offside, false);
  assert.equal(PITCH_SIZE_META['6v6'].offside, false);
  assert.equal(PITCH_SIZE_META['7v7'].offside, false);
  assert.equal(PITCH_SIZE_META['11v11'].offside, true);

  assert.equal(FORMATIONS_CATALOG['6v6'].length, 5);
  assert.equal(FORMATIONS_CATALOG['5v5'].length, 3);
  assert.equal(FORMATIONS_CATALOG['7v7'].length, 3);
  assert.equal(FORMATIONS_CATALOG['11v11'].length, 4);

  for (const [size, forms] of Object.entries(FORMATIONS_CATALOG)) {
    const expectedCount = PITCH_SIZE_META[size as keyof typeof PITCH_SIZE_META].count;
    for (const f of forms) {
      assert.equal(f.slots.length, expectedCount, `${f.id} slot count mismatch`);
      assert.equal(f.oppDefault.length, expectedCount, `${f.id} opp count mismatch`);
    }
  }
});

test('10 tactical scenarios all have sequential keyframes with valid coordinates and Arabic narration', () => {
  assert.equal(TACTICAL_SCENARIOS_10.length, 10);
  for (const sc of TACTICAL_SCENARIOS_10) {
    assert.ok(sc.frames.length >= 3, `Scenario ${sc.id} needs >= 3 frames`);
    for (const fr of sc.frames) {
      assert.equal(fr.ourPos.length, 6);
      assert.equal(fr.oppPos.length, 6);
      assert.ok(fr.narration.length > 15);
      assert.ok(fr.ball.x >= 0 && fr.ball.x <= 100);
      assert.ok(fr.ball.y >= 0 && fr.ball.y <= 100);
    }
  }
});

test('Formation 4 phases and Role Spotlight generate valid multi-step animations for 6v6 and 11v11', () => {
  for (const phase of ['attack', 'defend', 'counter', 'gegenpress'] as const) {
    const seq = getFormationPhaseSequence('6v6', '2-1-2', phase);
    assert.ok(seq.frames.length >= 3);
    assert.equal(seq.offsideEnabled, false);
    assert.equal(seq.frames[0].ourPos.length, 6);
  }

  const seq11 = getFormationPhaseSequence('11v11', '4-3-3', 'attack');
  assert.equal(seq11.offsideEnabled, true);
  assert.equal(seq11.frames[0].ourPos.length, 11);

  const spot = getRoleSpotlightSequence('6v6', '2-2-1', 5);
  assert.equal(spot.roleGroup, 'fwd');
  assert.equal(spot.sequence.frames.length, 4);
  assert.ok(spot.offenseDuties.length >= 2);
  assert.ok(spot.defenseDuties.length >= 2);
});

test('splitFairTeams balances available players and excludes unavailable players', () => {
  const split = splitFairTeams(SAMPLE_SQUAD, 'فريق السداسي');
  assert.equal(split.excludedUnavailable.length, 1);
  assert.equal(split.gold.length + split.silver.length, 7);
  assert.ok(Math.abs(split.gold.length - split.silver.length) <= 1);
  assert.ok(split.diff <= 8);
  assert.ok(split.whatsappText.includes('الفريق الذهبي'));
  assert.ok(split.whatsappText.includes('الفريق الفضي'));
});

test('suggestSmartLineup excludes injured players and assigns GK to GK slot', () => {
  const form = FORMATIONS_CATALOG['6v6'][0]; // 2-2-1
  const res = suggestSmartLineup(SAMPLE_SQUAD, form);
  assert.equal(res.excludedCount, 1);
  assert.equal(res.assignedCount, 6);
  assert.equal(res.slots['2-2-1_0'], 'p1'); // GK goes to GK slot
  assert.ok(!Object.values(res.slots).includes('p7')); // injured excluded
});

test('computeTeamChemistry and buildRotationPlan produce valid results', () => {
  const form = FORMATIONS_CATALOG['6v6'][0];
  const chem = computeTeamChemistry(form, SAMPLE_SQUAD.slice(0, 6));
  assert.ok(chem.totalPct >= 50 && chem.totalPct <= 99);
  assert.ok(chem.avgOvr >= 60 && chem.avgOvr <= 99);
  assert.equal(chem.linkResults.length, form.links.length);

  const plan = buildRotationPlan(SAMPLE_SQUAD, 6, 12);
  assert.equal(plan.starters.length, 6);
  assert.equal(plan.bench.length, 1);
  assert.ok(plan.schedule.length >= 3);
  assert.equal(plan.schedule[0].minute, 12);
});
