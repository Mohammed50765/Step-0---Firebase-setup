import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATION_BUDGET,
  STAT6_MIN,
  STAT6_MAX,
  OVR_MIN,
  OVR_MAX,
  PITCH_MODE_MULTIPLIER,
  validateCardCreationBudget,
  getPresetStats6ForPosition,
  deriveStats6FromLegacySkills,
  normalizeStats6ToBudget,
  mapStats6ToLegacySkills,
  computePositionWeightedOvr,
  computeMatchPerformanceScore,
  computeRealisticCardRating,
  getPitchModeMultiplier,
  resolvePositionRole,
  type Stats6,
  type VerifiedMatchInput,
} from './ratingEngine.ts';

describe('Maydan Realistic Anti-Inflation Rating Engine (Phase A)', () => {
  it('enforces exact 360-point creation budget with 40–85 bounds and blocks invalid totals', () => {
    const validStats: Stats6 = { PAC: 70, SHO: 75, PAS: 55, DRI: 65, DEF: 45, PHY: 50 };
    const ok = validateCardCreationBudget(validStats);
    assert.equal(ok.valid, true);
    assert.equal(ok.total, CREATION_BUDGET);
    assert.equal(ok.remaining, 0);
    assert.equal(ok.errors.length, 0);

    // Under budget (359) must block save
    const under = validateCardCreationBudget({ ...validStats, PHY: 49 });
    assert.equal(under.valid, false);
    assert.equal(under.remaining, 1);

    // Over budget (361) must block save
    const over = validateCardCreationBudget({ ...validStats, PHY: 51 });
    assert.equal(over.valid, false);
    assert.equal(over.remaining, -1);

    // Out-of-bounds (<40 or >85) must fail even if total === 360
    const belowMin = validateCardCreationBudget({ PAC: 39, SHO: 76, PAS: 55, DRI: 65, DEF: 45, PHY: 80 });
    assert.equal(belowMin.valid, false);
    const aboveMax = validateCardCreationBudget({ PAC: 86, SHO: 70, PAS: 54, DRI: 60, DEF: 45, PHY: 45 });
    assert.equal(aboveMax.valid, false);

    // NaN safety
    const badNaN = validateCardCreationBudget({ PAC: Number.NaN, SHO: 60, PAS: 60, DRI: 60, DEF: 60, PHY: 60 });
    assert.equal(badNaN.valid, false);
    assert.ok(Number.isFinite(badNaN.stats6.PAC));

    // All position presets must sum to 360 and stay inside [40, 85]
    for (const pos of ['مهاجم', 'جناح', 'لاعب وسط', 'مدافع', 'حارس مرمى']) {
      const preset = getPresetStats6ForPosition(pos);
      const check = validateCardCreationBudget(preset);
      assert.equal(check.valid, true, `Preset for ${pos} must be valid 360`);
      for (const v of Object.values(preset)) {
        assert.ok(v >= STAT6_MIN && v <= STAT6_MAX);
      }
    }
  });

  it('safely preserves legacy 10-skill players and bridges cleanly with 6 core stats', () => {
    const legacySkills = {
      speed: 8,
      shooting: 9,
      passing: 7,
      dribbling: 8,
      defending: 4,
      stamina: 7,
      vision: 7,
      teamwork: 6,
      control: 8,
      positioning: 5,
    };
    const derived = deriveStats6FromLegacySkills(legacySkills);
    assert.equal(derived.PAC, 80);
    assert.equal(derived.SHO, 90);
    assert.equal(derived.PAS, 70);
    assert.equal(derived.DRI, 80);
    assert.equal(derived.DEF, 45);
    assert.equal(derived.PHY, 65);

    const normalized = normalizeStats6ToBudget(derived, 360);
    assert.equal(validateCardCreationBudget(normalized).valid, true);

    const mappedBack = mapStats6ToLegacySkills(normalized, legacySkills);
    assert.ok(mappedBack.speed >= 1 && mappedBack.speed <= 10);
    assert.ok(mappedBack.shooting >= 1 && mappedBack.shooting <= 10);
  });

  it('computes position-weighted OVR (70% primary / 30% secondary) for all 5 roles instead of simple average', () => {
    // Striker-skewed build (sum = 360, simple mean = 60)
    const strikerBuild: Stats6 = { PAC: 80, SHO: 85, DRI: 75, PAS: 40, PHY: 40, DEF: 40 };
    const stOvr = computePositionWeightedOvr(strikerBuild, 'مهاجم');
    // 0.7 * ((85+75+80)/3=80) + 0.3 * ((40+40+40)/3=40) = 56 + 12 = 68
    assert.equal(stOvr, 68);
    // Same stats as Defender: 0.7 * ((40+40)/2=40) + 0.3 * ((80+40+75+85)/4=70) = 28 + 21 = 49
    const defOvrWithStrikerStats = computePositionWeightedOvr(strikerBuild, 'مدافع');
    assert.equal(defOvrWithStrikerStats, 49);
    assert.ok(stOvr > defOvrWithStrikerStats + 15);

    // CAM / Winger: 70% (PAS, DRI) + 30% (PAC, SHO, DEF, PHY)
    const camBuild: Stats6 = { PAS: 84, DRI: 82, PAC: 54, SHO: 50, DEF: 44, PHY: 46 };
    // 0.7 * 83 + 0.3 * 48.5 = 58.1 + 14.55 = 72.65 -> 73
    assert.equal(computePositionWeightedOvr(camBuild, 'جناح'), 73);
    assert.equal(computePositionWeightedOvr(camBuild, 'لاعب وسط', 'CAM_WINGER'), 73);

    // CM: 70% (PAS, DRI, PHY) + 30% (DEF, SHO, PAC)
    const cmBuild: Stats6 = { PAS: 80, DRI: 76, PHY: 78, DEF: 42, SHO: 42, PAC: 42 };
    // 0.7 * 78 + 0.3 * 42 = 54.6 + 12.6 = 67.2 -> 67
    assert.equal(computePositionWeightedOvr(cmBuild, 'لاعب وسط'), 67);

    // DEF / CB: 70% (DEF, PHY) + 30% (PAC, PAS, DRI, SHO)
    const cbBuild: Stats6 = { DEF: 84, PHY: 82, PAC: 54, PAS: 50, DRI: 46, SHO: 44 };
    // 0.7 * 83 + 0.3 * 48.5 = 73
    assert.equal(computePositionWeightedOvr(cbBuild, 'مدافع'), 73);

    // GK: 70% (DEF saves/positioning, PHY reflexes) + 30% (PAS, PAC)
    const gkBuild: Stats6 = { DEF: 85, PHY: 85, PAS: 60, PAC: 50, SHO: 40, DRI: 40 };
    // 0.7 * 85 + 0.3 * 55 = 59.5 + 16.5 = 76
    assert.equal(computePositionWeightedOvr(gkBuild, 'حارس مرمى'), 76);

    // Clamping & NaN safety
    assert.equal(computePositionWeightedOvr({ PAC: 999, SHO: 999, PAS: 999, DRI: 999, DEF: 999, PHY: 999 }, 'مهاجم'), OVR_MAX);
    assert.equal(computePositionWeightedOvr({ PAC: -50, SHO: Number.NaN, PAS: 0, DRI: 0, DEF: 0, PHY: 0 }, 'مهاجم') >= OVR_MIN, true);
  });

  it('weights 1 goal or assist in 11v11 at 2.2x its weight in 6v6 and rewards DEF/GK clean sheets', () => {
    assert.equal(PITCH_MODE_MULTIPLIER['6v6'], 1.0);
    assert.equal(PITCH_MODE_MULTIPLIER['11v11'], 2.2);
    assert.equal(getPitchModeMultiplier('11v11'), 2.2);
    assert.equal(getPitchModeMultiplier('6v6'), 1.0);

    const perf6 = computeMatchPerformanceScore(
      { goals: 1, assists: 1, matchResult: 'فوز', pitchMode: '6v6', peerVoteScore: null },
      'مهاجم'
    );
    const perf11 = computeMatchPerformanceScore(
      { goals: 1, assists: 1, matchResult: 'فوز', pitchMode: '11v11', peerVoteScore: null },
      'مهاجم'
    );
    assert.ok(perf11.realStatsScore > perf6.realStatsScore);
    // Exact 2.2x difference on offensive contribution (1*6.5 + 1*4.5 = 11 vs 24.2 -> +13.2 diff)
    assert.ok(Math.abs(perf11.realStatsScore - perf6.realStatsScore - 13.2) < 0.05);

    // Hybrid 70% real stats + 30% peer vote
    const hybrid = computeMatchPerformanceScore(
      { goals: 1, assists: 0, matchResult: 'تعادل', pitchMode: '6v6', peerVoteScore: 10 },
      'مهاجم'
    );
    assert.equal(hybrid.usedPeerVote, true);
    assert.equal(hybrid.peerVoteScoreNormalized, 99);
    const expectedHybrid = Number((hybrid.realStatsScore * 0.7 + 99 * 0.3).toFixed(2));
    assert.equal(hybrid.matchScore, expectedHybrid);

    // Clean-sheet bonus for GK & DEF vs striker
    const gkClean = computeMatchPerformanceScore(
      { goals: 0, assists: 0, interceptions: 4, goalsConceded: 0, matchResult: 'فوز', pitchMode: '6v6' },
      'حارس مرمى'
    );
    const gkConcededMany = computeMatchPerformanceScore(
      { goals: 0, assists: 0, interceptions: 4, goalsConceded: 7, matchResult: 'فوز', pitchMode: '6v6' },
      'حارس مرمى'
    );
    assert.ok(gkClean.cleanSheetBonus > 0);
    assert.ok(gkConcededMany.cleanSheetBonus < 0);
    assert.ok(gkClean.matchScore > gkConcededMany.matchScore + 15);
  });

  it('uses rolling window (5–8 verified matches), diminishing returns, realistic -1 decline, separate form arrow, and isolates training XP', () => {
    // 1) Rolling window drops older matches beyond 8 (prevents infinite grinding)
    const oldGreatMatches: VerifiedMatchInput[] = Array.from({ length: 12 }, () => ({
      goals: 3,
      assists: 2,
      matchResult: 'فوز',
      pitchMode: '6v6',
      peerVoteScore: 9.5,
      verified: true,
    }));
    const recentAvgMatches: VerifiedMatchInput[] = Array.from({ length: 8 }, () => ({
      goals: 0,
      assists: 0,
      matchResult: 'تعادل',
      pitchMode: '6v6',
      peerVoteScore: 5.5,
      verified: true,
    }));

    const baseStats: Stats6 = { PAC: 66, SHO: 68, DRI: 66, PAS: 54, DEF: 50, PHY: 56 }; // ST baseOvr ~ 62
    const withOldThenAvg = computeRealisticCardRating({
      stats6: baseStats,
      primaryPos: 'مهاجم',
      verifiedMatches: [...oldGreatMatches, ...recentAvgMatches],
    });
    assert.equal(withOldThenAvg.windowMatchesUsed, 8);
    assert.equal(withOldThenAvg.totalVerifiedMatches, 20);
    // Because the last 8 matches were average, the 12 old great matches MUST NOT inflate OVR!
    assert.ok(withOldThenAvg.deltaFromMatches <= 1);

    // 2) Draft matches (verified: false) are excluded completely
    const withDrafts = computeRealisticCardRating({
      stats6: baseStats,
      primaryPos: 'مهاجم',
      verifiedMatches: [
        { goals: 5, assists: 5, matchResult: 'فوز', pitchMode: '11v11', peerVoteScore: 10, verified: false },
        { goals: 5, assists: 5, matchResult: 'فوز', pitchMode: '11v11', peerVoteScore: 10, status: 'draft' },
      ],
    });
    assert.equal(withDrafts.windowMatchesUsed, 0);
    assert.equal(withDrafts.finalOvr, withDrafts.baseOvr);

    // 3) Diminishing returns: same great 6-match streak gives larger delta at OVR 65 than at OVR 86
    const greatStreak: VerifiedMatchInput[] = Array.from({ length: 6 }, () => ({
      goals: 2,
      assists: 1,
      matchResult: 'فوز',
      pitchMode: '11v11',
      peerVoteScore: 9.2,
      verified: true,
    }));
    const lowTier = computeRealisticCardRating({
      stats6: { PAC: 68, SHO: 70, DRI: 68, PAS: 54, DEF: 48, PHY: 52 }, // baseOvr ~ 64 (60-72)
      primaryPos: 'مهاجم',
      verifiedMatches: greatStreak,
    });
    const highTier = computeRealisticCardRating({
      stats6: { PAC: 88, SHO: 90, DRI: 88, PAS: 84, DEF: 80, PHY: 84 }, // baseOvr ~ 87 (86+)
      primaryPos: 'مهاجم',
      verifiedMatches: greatStreak,
    });
    assert.equal(lowTier.diminishingBracket, '60-72');
    assert.equal(highTier.diminishingBracket, '86+');
    assert.ok(lowTier.deltaFromMatches > highTier.deltaFromMatches);
    assert.ok(highTier.deltaFromMatches <= 1);

    // 4) Realistic decline: 3 consecutive poor verified matches apply -1 to base OVR
    const poorThree: VerifiedMatchInput[] = Array.from({ length: 3 }, () => ({
      goals: 0,
      assists: 0,
      turnovers: 8,
      matchResult: 'خسارة',
      pitchMode: '6v6',
      peerVoteScore: 3,
      verified: true,
    }));
    const declined = computeRealisticCardRating({
      stats6: { PAC: 76, SHO: 78, DRI: 76, PAS: 60, DEF: 50, PHY: 60 },
      primaryPos: 'مهاجم',
      verifiedMatches: poorThree,
    });
    assert.equal(declined.declineApplied, true);
    assert.equal(declined.declineDelta, -1);
    assert.equal(declined.finalOvr, declined.baseOvr - 1);
    assert.equal(declined.formArrow, 'down');

    // 5) Form arrow reflects ONLY last 2 matches separately from base OVR
    const risingForm = computeRealisticCardRating({
      stats6: baseStats,
      primaryPos: 'مهاجم',
      verifiedMatches: [
        { goals: 0, assists: 0, matchResult: 'خسارة', pitchMode: '6v6', peerVoteScore: 4, verified: true },
        { goals: 2, assists: 1, matchResult: 'فوز', pitchMode: '6v6', peerVoteScore: 9, verified: true },
        { goals: 2, assists: 1, matchResult: 'فوز', pitchMode: '6v6', peerVoteScore: 9, verified: true },
      ],
    });
    assert.equal(risingForm.formArrow, 'up');
    assert.equal(risingForm.formIcon, '🟢');
    assert.equal(risingForm.baseOvr, computePositionWeightedOvr(baseStats, 'مهاجم'));

    // 6) Training XP & streaks NEVER increase official OVR
    const noTraining = computeRealisticCardRating({
      stats6: baseStats,
      primaryPos: 'مهاجم',
      verifiedMatches: [],
      trainingXp: 0,
      trainingStreak: 0,
    });
    const hugeTraining = computeRealisticCardRating({
      stats6: baseStats,
      primaryPos: 'مهاجم',
      verifiedMatches: [],
      trainingXp: 99999,
      trainingStreak: 365,
    });
    assert.equal(hugeTraining.finalOvr, noTraining.finalOvr);
    assert.equal(hugeTraining.baseOvr, noTraining.baseOvr);
    assert.ok(hugeTraining.trainingNote.includes('XP'));
    assert.equal(resolvePositionRole('صانع ألعاب'), 'CAM_WINGER');
  });
});
