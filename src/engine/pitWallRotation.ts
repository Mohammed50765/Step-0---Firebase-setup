import type { MinimalPlayer, MinimalReadinessLog } from '../tacticsData';
import { clampNumber } from './tacticalGeometry';

export type TacticalPlayStyle = 'high_press' | 'balanced' | 'counter';

export interface PitWallConfig {
  matchMinutes: number;
  startersCount: number;
  style: TacticalPlayStyle;
  unavailableIds?: string[];
  readinessLogs?: MinimalReadinessLog[];
  /** Optional explicit substitution minutes from Dual Match & Substitution Timer (interval or manual mode) */
  customScheduleMinutes?: number[];
}

export interface RotationPlayerSummary {
  id: string;
  name: string;
  primaryPos: string;
  isGk: boolean;
  initialFatigue: number; // 0..40 estimated starting fatigue from readiness logs
  plannedMinutes: number;
}

export interface RotationSubEvent {
  id: string;
  minute: number;
  outPlayerId: string;
  outPlayerName: string;
  inPlayerId: string;
  inPlayerName: string;
  roleLabel: string;
  reasonAr: string;
}

export interface FatigueCurvePoint {
  minute: number;
  /** 0 = completely fresh, 100 = peak estimated exertion */
  fatiguePct: number;
  /** 100 - fatiguePct for intuitive display */
  freshnessPct: number;
  onPitch: boolean;
}

export interface PlayerFatigueTrack {
  playerId: string;
  playerName: string;
  isGk: boolean;
  plannedMinutes: number;
  peakFatiguePct: number;
  endFatiguePct: number;
  points: FatigueCurvePoint[];
}

export interface PitWallRotationPlan {
  matchMinutes: number;
  startersCount: number;
  style: TacticalPlayStyle;
  intervalMinutes: number;
  starters: RotationPlayerSummary[];
  bench: RotationPlayerSummary[];
  excluded: Array<{ id: string; name: string; reasonAr: string }>;
  events: RotationSubEvent[];
  playerMinutes: Record<string, number>;
  fairnessSpreadMin: number;
  fatigueTracks: PlayerFatigueTrack[];
  disclaimerAr: string;
}

export const STYLE_META: Record<
  TacticalPlayStyle,
  { labelAr: string; baseIntervalMin: number; pitchFatiguePerMin: number; benchRecoverPerMin: number }
> = {
  high_press: {
    labelAr: 'ضغط عالٍ',
    baseIntervalMin: 8,
    pitchFatiguePerMin: 2.85,
    benchRecoverPerMin: 3.1,
  },
  balanced: {
    labelAr: 'متوازن',
    baseIntervalMin: 11,
    pitchFatiguePerMin: 2.1,
    benchRecoverPerMin: 2.8,
  },
  counter: {
    labelAr: 'مرتدات وتنظيم',
    baseIntervalMin: 14,
    pitchFatiguePerMin: 1.7,
    benchRecoverPerMin: 2.6,
  },
};

function isGoalkeeper(p: MinimalPlayer): boolean {
  const pos = (p.primaryPos || '').toLowerCase();
  return pos.includes('حارس') || pos.includes('gk') || pos.includes('goalkeeper');
}

function getInitialFatigueFromReadiness(
  playerId: string,
  readinessLogs?: MinimalReadinessLog[]
): number {
  if (!readinessLogs || !readinessLogs.length) return 6;
  // Find latest log for this player
  let latest: MinimalReadinessLog | null = null;
  for (const log of readinessLogs) {
    if (log.playerId !== playerId) continue;
    if (!latest || (log.date || '') >= (latest.date || '')) {
      latest = log;
    }
  }
  if (!latest) return 6;
  // readiness.fatigue is typically 1..5 (higher = more tired) or readiness score 0..100
  if (typeof latest.fatigue === 'number' && Number.isFinite(latest.fatigue)) {
    const norm = latest.fatigue <= 5 ? (latest.fatigue - 1) * 7 : latest.fatigue * 0.3;
    return Math.round(clampNumber(norm, 4, 34));
  }
  return 6;
}

/**
 * Recomputes planned minutes and estimated minute-by-minute fatigue curves from a fixed
 * starter list + ordered substitution events.
 */
export function recalculateMinutesAndFatigue(
  starters: RotationPlayerSummary[],
  bench: RotationPlayerSummary[],
  events: RotationSubEvent[],
  matchMinutes: number,
  style: TacticalPlayStyle
): {
  playerMinutes: Record<string, number>;
  fairnessSpreadMin: number;
  fatigueTracks: PlayerFatigueTrack[];
} {
  const safeMatch = Math.round(clampNumber(matchMinutes, 1, 240));
  const styleCfg = STYLE_META[style] || STYLE_META.balanced;
  const allPlayers = [...starters, ...bench];
  const sortedEvents = [...events]
    .filter((e) => e.minute > 0 && e.minute < safeMatch)
    .sort((a, b) => a.minute - b.minute);

  const onPitchSet = new Set<string>(starters.map((p) => p.id));
  const minutesPlayed: Record<string, number> = {};
  const fatigueNow: Record<string, number> = {};
  const tracksMap: Record<string, FatigueCurvePoint[]> = {};
  const peakFatigue: Record<string, number> = {};

  for (const p of allPlayers) {
    minutesPlayed[p.id] = 0;
    fatigueNow[p.id] = p.initialFatigue;
    peakFatigue[p.id] = p.initialFatigue;
    tracksMap[p.id] = [
      {
        minute: 0,
        fatiguePct: p.initialFatigue,
        freshnessPct: 100 - p.initialFatigue,
        onPitch: onPitchSet.has(p.id),
      },
    ];
  }

  let evCursor = 0;
  for (let m = 1; m <= safeMatch; m++) {
    // Apply substitutions scheduled at minute m - 1 (start of minute m) or exact minute m
    while (evCursor < sortedEvents.length && sortedEvents[evCursor].minute <= m) {
      const ev = sortedEvents[evCursor++];
      if (onPitchSet.has(ev.outPlayerId)) {
        onPitchSet.delete(ev.outPlayerId);
      }
      onPitchSet.add(ev.inPlayerId);
    }

    for (const p of allPlayers) {
      const playing = onPitchSet.has(p.id);
      if (playing) {
        minutesPlayed[p.id] += 1;
        // Goalkeepers accumulate less running exertion than outfield players
        const roleMult = p.isGk ? 0.35 : 1.0;
        // Mild non-linear fatigue creep after 20+ accumulated minutes
        const cumMult = minutesPlayed[p.id] > 24 ? 1.18 : 1.0;
        fatigueNow[p.id] = clampNumber(
          fatigueNow[p.id] + styleCfg.pitchFatiguePerMin * roleMult * cumMult,
          0,
          98
        );
      } else {
        // Bench recovery toward a realistic floor (cannot drop below initial fatigue)
        fatigueNow[p.id] = clampNumber(
          fatigueNow[p.id] - styleCfg.benchRecoverPerMin,
          Math.max(4, p.initialFatigue * 0.8),
          98
        );
      }
      const rounded = Math.round(fatigueNow[p.id]);
      if (rounded > peakFatigue[p.id]) peakFatigue[p.id] = rounded;

      // Record point every 2 minutes + exact final minute
      if (m % 2 === 0 || m === safeMatch) {
        tracksMap[p.id].push({
          minute: m,
          fatiguePct: rounded,
          freshnessPct: 100 - rounded,
          onPitch: playing,
        });
      }
    }
  }

  // Outfield fairness spread (max - min minutes among outfield available players)
  const outfieldMins = allPlayers.filter((p) => !p.isGk).map((p) => minutesPlayed[p.id] || 0);
  const fairnessSpreadMin =
    outfieldMins.length >= 2 ? Math.max(...outfieldMins) - Math.min(...outfieldMins) : 0;

  const fatigueTracks: PlayerFatigueTrack[] = allPlayers.map((p) => {
    const pts = tracksMap[p.id] || [];
    const last = pts[pts.length - 1];
    return {
      playerId: p.id,
      playerName: p.name,
      isGk: p.isGk,
      plannedMinutes: minutesPlayed[p.id] || 0,
      peakFatiguePct: peakFatigue[p.id] || p.initialFatigue,
      endFatiguePct: last ? last.fatiguePct : p.initialFatigue,
      points: pts,
    };
  });

  return { playerMinutes: minutesPlayed, fairnessSpreadMin, fatigueTracks };
}

/**
 * Generates a fair, position-aware bench rotation schedule using real team roster & availability.
 * Automatically excludes unavailable players and adapts rotation interval to playing style.
 */
export function generatePitWallPlan(
  players: MinimalPlayer[],
  config: PitWallConfig
): PitWallRotationPlan {
  const matchMinutes = Math.round(clampNumber(config.matchMinutes || 60, 1, 240));
  const startersCount = Math.round(clampNumber(config.startersCount || 6, 4, 11));
  const style: TacticalPlayStyle = STYLE_META[config.style] ? config.style : 'balanced';
  const styleCfg = STYLE_META[style];
  const unavailSet = new Set(config.unavailableIds || []);

  const excluded: Array<{ id: string; name: string; reasonAr: string }> = [];
  const available: MinimalPlayer[] = [];

  for (const p of players || []) {
    if (!p || !p.id) continue;
    if (p.availableStatus === 'unavailable' || unavailSet.has(p.id)) {
      excluded.push({
        id: p.id,
        name: p.name || 'لاعب',
        reasonAr: 'غير متاح في جلسة المباراة',
      });
    } else {
      available.push(p);
    }
  }

  // Sort available so 1 GK leads starters, followed by fresher outfield players
  const gks = available.filter(isGoalkeeper);
  const outfield = available
    .filter((p) => !isGoalkeeper(p))
    .sort(
      (a, b) =>
        getInitialFatigueFromReadiness(a.id, config.readinessLogs) -
        getInitialFatigueFromReadiness(b.id, config.readinessLogs)
    );

  const ordered: MinimalPlayer[] = [];
  if (gks.length > 0) ordered.push(gks[0]);
  ordered.push(...outfield);
  if (gks.length > 1) ordered.push(...gks.slice(1));

  const toSummary = (p: MinimalPlayer): RotationPlayerSummary => ({
    id: p.id,
    name: p.name || 'لاعب',
    primaryPos: p.primaryPos || 'وسط',
    isGk: isGoalkeeper(p),
    initialFatigue: getInitialFatigueFromReadiness(p.id, config.readinessLogs),
    plannedMinutes: 0,
  });

  const starters = ordered.slice(0, startersCount).map(toSummary);
  const bench = ordered.slice(startersCount).map(toSummary);

  // Build timed substitution slots for outfield players (plus GK swap at halftime only if 2+ GKs)
  const events: RotationSubEvent[] = [];
  const outfieldBench = bench.filter((p) => !p.isGk);
  const gkBench = bench.filter((p) => p.isGk);

  // Adaptive interval: ensure at least enough slots so everyone gets fair rotation
  const baseInt = styleCfg.baseIntervalMin;
  const intervalMinutes = Math.max(
    5,
    Math.min(baseInt, Math.floor(matchMinutes / Math.max(2, outfieldBench.length + 2)))
  );

  // Simulate active outfield pool to always swap the highest-minute/most-fatigued player with freshest bench player
  const activeOutfield = starters.filter((p) => !p.isGk).map((p) => ({
    ...p,
    mins: 0,
    stintMins: 0,
    fatigue: p.initialFatigue,
  }));
  const restingOutfield = outfieldBench.map((p) => ({
    ...p,
    mins: 0,
    stintMins: 0,
    fatigue: p.initialFatigue,
  }));

  if (restingOutfield.length > 0 && activeOutfield.length > 0) {
    let eventIdx = 1;
    const customWindows = Array.isArray(config.customScheduleMinutes)
      ? Array.from(
          new Set(
            config.customScheduleMinutes
              .map((m) => Math.round(Number(m)))
              .filter((m) => Number.isFinite(m) && m >= 1 && m < matchMinutes)
          )
        ).sort((a, b) => a - b)
      : null;

    const windows: number[] = [];
    if (customWindows) {
      windows.push(...customWindows);
    } else {
      for (let minute = intervalMinutes; minute <= matchMinutes - 4; minute += intervalMinutes) {
        windows.push(minute);
      }
    }

    let prevMinute = 0;
    for (const minute of windows) {
      const deltaMin = Math.max(1, minute - prevMinute);
      prevMinute = minute;
      // Advance elapsed mins/fatigue for this block
      for (const a of activeOutfield) {
        a.mins += deltaMin;
        a.stintMins += deltaMin;
        a.fatigue = clampNumber(a.fatigue + deltaMin * styleCfg.pitchFatiguePerMin, 0, 98);
      }
      for (const b of restingOutfield) {
        b.fatigue = clampNumber(
          b.fatigue - deltaMin * styleCfg.benchRecoverPerMin,
          b.initialFatigue * 0.8,
          98
        );
      }

      // In custom schedule mode, create 1 primary rotation pairing per scheduled window (or up to 2 in default auto mode)
      const subsThisWindow = customWindows
        ? 1
        : Math.min(restingOutfield.length, activeOutfield.length, 2);
      for (let s = 0; s < subsThisWindow; s++) {
        // Pick outgoing: highest (mins + fatigue*0.25)
        activeOutfield.sort((x, y) => y.mins + y.fatigue * 0.2 - (x.mins + x.fatigue * 0.2));
        // Pick incoming: lowest mins, then lowest fatigue
        restingOutfield.sort((x, y) => x.mins - y.mins || x.fatigue - y.fatigue);

        const outP = activeOutfield.shift()!;
        const inP = restingOutfield.shift()!;

        events.push({
          id: `sub_${minute}_${eventIdx++}`,
          minute,
          outPlayerId: outP.id,
          outPlayerName: outP.name,
          inPlayerId: inP.id,
          inPlayerName: inP.name,
          roleLabel: outP.primaryPos || 'ميدان',
          reasonAr:
            style === 'high_press'
              ? 'تجديد نسق الضغط العالي وتوزيع الدقائق بعدالة'
              : 'تدوير عادل للحفاظ على التوازن البدني',
        });

        outP.stintMins = 0;
        inP.stintMins = 0;
        activeOutfield.push(inP);
        restingOutfield.push(outP);
      }
    }
  }

  // Optional GK rotation at halftime if a backup GK is available
  const startingGk = starters.find((p) => p.isGk);
  if (startingGk && gkBench.length > 0 && matchMinutes >= 20) {
    const halfMin = Math.round(matchMinutes / 2);
    events.push({
      id: `sub_gk_${halfMin}`,
      minute: halfMin,
      outPlayerId: startingGk.id,
      outPlayerName: startingGk.name,
      inPlayerId: gkBench[0].id,
      inPlayerName: gkBench[0].name,
      roleLabel: 'حارس مرمى',
      reasonAr: 'مناوبة عادلة لحراسة المرمى عند منتصف المباراة',
    });
  }

  events.sort((a, b) => a.minute - b.minute);

  const calc = recalculateMinutesAndFatigue(starters, bench, events, matchMinutes, style);
  const startersWithMins = starters.map((p) => ({
    ...p,
    plannedMinutes: calc.playerMinutes[p.id] || 0,
  }));
  const benchWithMins = bench.map((p) => ({
    ...p,
    plannedMinutes: calc.playerMinutes[p.id] || 0,
  }));

  return {
    matchMinutes,
    startersCount,
    style,
    intervalMinutes,
    starters: startersWithMins,
    bench: benchWithMins,
    excluded,
    events,
    playerMinutes: calc.playerMinutes,
    fairnessSpreadMin: calc.fairnessSpreadMin,
    fatigueTracks: calc.fatigueTracks,
    disclaimerAr:
      'منحنى الإجهاد تقديري مبني على دقائق اللعب وأسلوب الضغط وفترات الراحة فقط — وليس قياساً فسيولوجياً أو طبياً.',
  };
}

/**
 * Allows the captain to manually edit any substitution event (minute / outgoing / incoming)
 * and cleanly recalculates planned minutes and fatigue curves.
 */
export function applyManualRotationEdit(
  plan: PitWallRotationPlan,
  eventId: string,
  patch: { minute?: number; outPlayerId?: string; inPlayerId?: string }
): PitWallRotationPlan {
  const allPlayers = [...plan.starters, ...plan.bench];
  const byId = new Map(allPlayers.map((p) => [p.id, p]));

  const nextEvents = plan.events.map((ev) => {
    if (ev.id !== eventId) return ev;
    const nextMin =
      typeof patch.minute === 'number'
        ? Math.round(clampNumber(patch.minute, 1, plan.matchMinutes - 1))
        : ev.minute;
    const outP = patch.outPlayerId ? byId.get(patch.outPlayerId) : byId.get(ev.outPlayerId);
    const inP = patch.inPlayerId ? byId.get(patch.inPlayerId) : byId.get(ev.inPlayerId);
    if (!outP || !inP || outP.id === inP.id) {
      return { ...ev, minute: nextMin };
    }
    return {
      ...ev,
      minute: nextMin,
      outPlayerId: outP.id,
      outPlayerName: outP.name,
      inPlayerId: inP.id,
      inPlayerName: inP.name,
      roleLabel: outP.primaryPos || ev.roleLabel,
      reasonAr: 'تعديل يدوي من الكابتن',
    };
  });

  nextEvents.sort((a, b) => a.minute - b.minute);
  const calc = recalculateMinutesAndFatigue(
    plan.starters,
    plan.bench,
    nextEvents,
    plan.matchMinutes,
    plan.style
  );

  return {
    ...plan,
    events: nextEvents,
    starters: plan.starters.map((p) => ({ ...p, plannedMinutes: calc.playerMinutes[p.id] || 0 })),
    bench: plan.bench.map((p) => ({ ...p, plannedMinutes: calc.playerMinutes[p.id] || 0 })),
    playerMinutes: calc.playerMinutes,
    fairnessSpreadMin: calc.fairnessSpreadMin,
    fatigueTracks: calc.fatigueTracks,
  };
}

/**
 * Finds the next upcoming substitution relative to elapsed match seconds (for Offline Pit Mode).
 */
export function getNextUpcomingSub(
  plan: PitWallRotationPlan,
  elapsedSec: number
): { event: RotationSubEvent; secondsUntil: number } | null {
  const safeSec = Math.max(0, elapsedSec);
  for (const ev of plan.events) {
    const targetSec = ev.minute * 60;
    if (targetSec >= safeSec) {
      return { event: ev, secondsUntil: Math.max(0, Math.round(targetSec - safeSec)) };
    }
  }
  return null;
}
