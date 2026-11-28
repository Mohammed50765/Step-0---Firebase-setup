import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_DNA_CATALOG,
  getRoleDnaById,
  resolveRoleWithFormationSlot,
  evaluateRolePairings,
  type BlackBoxRoleId,
} from './roleDna';

test('ROLE_DNA_CATALOG defines all 4 MVP roles on 2-2-1 with complete tactical DNA fields', () => {
  assert.equal(ROLE_DNA_CATALOG.length, 4);
  const ids = ROLE_DNA_CATALOG.map((r) => r.id);
  assert.deepEqual(ids, ['anchor', 'buildup_libero', 'inverted_winger', 'false_9']);

  for (const role of ROLE_DNA_CATALOG) {
    assert.equal(role.formationId, '2-2-1');
    assert.ok(role.titleAr.length > 0);
    assert.ok(role.identityLine.length > 0);
    assert.ok(role.homePosition.x > 0 && role.homePosition.x < 100);
    assert.ok(role.homePosition.y > 0 && role.homePosition.y < 100);
    assert.ok(role.preferredZones.length >= 1, `${role.id} needs preferred zones`);
    assert.ok(role.conditionalZones.length >= 1, `${role.id} needs conditional zones`);
    assert.ok(role.highRiskZones.length >= 1, `${role.id} needs high-risk zones`);
    assert.ok(role.onBallResponsibilities.length >= 2);
    assert.ok(role.offBallResponsibilities.length >= 2);
    assert.ok(role.pressingTriggers.length >= 2);
    assert.ok(role.transitionBehavior.attackToDefense.length > 0);
    assert.ok(role.transitionBehavior.defenseToAttack.length > 0);
    assert.ok(role.partnerRelationships.length >= 2);
    assert.ok(role.commonMistakes.length >= 2);
    assert.ok(role.correctDecisions.length >= 1);
  }
});

test('resolveRoleWithFormationSlot links every Role DNA profile to canonical 2-2-1 formation slots', () => {
  const roleIds: BlackBoxRoleId[] = ['anchor', 'buildup_libero', 'inverted_winger', 'false_9'];
  for (const id of roleIds) {
    const resolved = resolveRoleWithFormationSlot(id);
    assert.equal(resolved.dna.id, id);
    assert.equal(resolved.slot.id, resolved.dna.slotId);
    assert.ok(resolved.legacySpotlightRule.length > 0);
  }
});

test('getRoleDnaById returns exact match and safely falls back', () => {
  assert.equal(getRoleDnaById('false_9').code, 'F9');
  assert.equal(getRoleDnaById('inverted_winger').code, 'INV');
});

test('evaluateRolePairings yields transparent explainable synergies and structural warnings', () => {
  // Full balanced 4-role setup -> 3 synergies, 0 warnings
  const full = evaluateRolePairings(['anchor', 'buildup_libero', 'inverted_winger', 'false_9']);
  assert.equal(full.synergies.length, 3);
  assert.equal(full.warnings.length, 0);

  // Libero without Anchor -> explicit depth exposure warning
  const noAnchor = evaluateRolePairings(['buildup_libero', 'inverted_winger']);
  assert.ok(noAnchor.synergies.some((s) => s.id === 'syn_libero_inverted'));
  assert.ok(noAnchor.warnings.some((w) => w.id === 'warn_libero_without_anchor'));

  // False 9 + Inverted Winger without Libero -> central crowding warning
  const crowded = evaluateRolePairings(['false_9', 'inverted_winger']);
  assert.ok(crowded.synergies.some((s) => s.id === 'syn_f9_inverted'));
  assert.ok(crowded.warnings.some((w) => w.id === 'warn_central_pocket_crowding'));

  // Anchor + False 9 alone -> vertical gap warning
  const gap = evaluateRolePairings(['anchor', 'false_9']);
  assert.ok(gap.warnings.some((w) => w.id === 'warn_vertical_gap'));

  // Ensure zero fabricated percentage strings in any rule output
  for (const item of [...full.synergies, ...noAnchor.warnings, ...crowded.warnings, ...gap.warnings]) {
    assert.ok(!/%/.test(item.title) && !/%/.test(item.explanation), 'No fabricated percentages allowed');
  }
});
