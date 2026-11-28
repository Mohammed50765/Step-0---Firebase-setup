/**
 * MAYDAN 6V6 — DUAL MATCH & SUBSTITUTION TIMER ENGINE
 * Synchronizes an independent match duration clock with an independent substitution
 * scheduler (Repeating Interval Mode + Manual Custom Schedule Mode), smart snooze/confirm
 * notifications, wall-clock timestamp accuracy across inactive tabs, and safe session persistence.
 */

export const MATCH_DURATION_PRESETS = [30, 45, 60, 75, 90] as const;
export const SUB_INTERVAL_PRESETS = [5, 10, 12, 15, 20] as const;
export const SNOOZE_DELAY_OPTIONS = [1, 2, 5] as const;

export const MIN_MATCH_DURATION_MIN = 1;
export const MAX_MATCH_DURATION_MIN = 240;
export const MIN_SUB_INTERVAL_MIN = 1;
export const MAX_SUB_INTERVAL_MIN = 120;

export type SubScheduleMode = 'interval' | 'manual';
export type SubSlotStatus = 'pending' | 'active_alert' | 'snoozed' | 'confirmed';

export interface SubPlayerPairing {
  outPlayerId: string;
  outPlayerName: string;
  inPlayerId: string;
  inPlayerName: string;
  roleLabel: string;
  reasonAr: string;
}

export interface ScheduledSubSlot {
  id: string;
  index: number;
  /** Original scheduled minute from match start (never lost when snoozed) */
  originalMinute: number;
  /** Effective trigger minute after any snooze/delay */
  effectiveMinute: number;
  /** Exact elapsed match second at which this substitution triggers */
  effectiveTriggerSec: number;
  /** Cumulative delay added via snooze in minutes */
  totalSnoozeMinutes: number;
  /** Number of times this slot was postponed */
  postponedCount: number;
  status: SubSlotStatus;
  /** Prevents duplicate notifications at the same trigger timestamp */
  lastAlertedAtTriggerSec: number | null;
  confirmedAtSec: number | null;
  pairing?: SubPlayerPairing;
}

export interface DualMatchTimerState {
  matchDurationMinutes: number;
  scheduleMode: SubScheduleMode;
  intervalMinutes: number;
  manualMinutes: number[];
  slots: ScheduledSubSlot[];
  isRunning: boolean;
  isPaused: boolean;
  matchEnded: boolean;
  matchEndAlerted: boolean;
  matchEndBannerOpen: boolean;
  accumulatedElapsedMs: number;
  runningSinceMs: number | null;
  activeAlertSlotId: string | null;
}

export type TimerAlertEvent =
  | {
      type: 'substitution';
      slot: ScheduledSubSlot;
    }
  | {
      type: 'match_end';
      matchDurationMinutes: number;
    };

export interface TimerTickResult {
  state: DualMatchTimerState;
  elapsedMs: number;
  elapsedSec: number;
  remainingSec: number;
  totalDurationSec: number;
  progressPct: number;
  newlyTriggeredAlerts: TimerAlertEvent[];
}

export interface NextScheduledSubInfo {
  slot: ScheduledSubSlot;
  secondsUntil: number;
  isPostponed: boolean;
  isDueNow: boolean;
}

export function formatMatchClock(sec: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function validateMatchDurationMinutes(
  raw: unknown
): { ok: true; minutes: number } | { ok: false; errorAr: string } {
  const num = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return { ok: false, errorAr: 'يرجى إدخال مدة مباراة رقمية صحيحة بالدقائق.' };
  }
  const rounded = Math.round(num);
  if (rounded < MIN_MATCH_DURATION_MIN || rounded > MAX_MATCH_DURATION_MIN) {
    return {
      ok: false,
      errorAr: `يجب أن تكون مدة المباراة بين ${MIN_MATCH_DURATION_MIN} و ${MAX_MATCH_DURATION_MIN} دقيقة.`,
    };
  }
  return { ok: true, minutes: rounded };
}

export function validateSubIntervalMinutes(
  raw: unknown
): { ok: true; minutes: number } | { ok: false; errorAr: string } {
  const num = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return { ok: false, errorAr: 'يرجى إدخال فترة تكرار رقمية صحيحة بالدقائق.' };
  }
  const rounded = Math.round(num);
  if (rounded < MIN_SUB_INTERVAL_MIN || rounded > MAX_SUB_INTERVAL_MIN) {
    return {
      ok: false,
      errorAr: `يجب أن تكون فترة التبديل الدوري بين ${MIN_SUB_INTERVAL_MIN} و ${MAX_SUB_INTERVAL_MIN} دقيقة.`,
    };
  }
  return { ok: true, minutes: rounded };
}

export function validateManualSubMinute(
  raw: unknown,
  matchDurationMinutes: number,
  existingMinutes: number[],
  editingOriginalMinute: number | null = null
): { ok: true; minute: number } | { ok: false; errorAr: string } {
  const num = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || !Number.isInteger(num)) {
    return { ok: false, errorAr: 'يرجى إدخال دقيقة تبديل صحيحة (رقم صحيح).' };
  }
  const maxAllowed = Math.max(1, matchDurationMinutes - 1);
  if (num < 1 || num >= matchDurationMinutes) {
    return {
      ok: false,
      errorAr: `يجب أن تكون دقيقة التبديل بين الدقيقة 1 والدقيقة ${maxAllowed} (قبل نهاية المباراة).`,
    };
  }
  const isDuplicate = existingMinutes.some(
    (m) => m === num && (editingOriginalMinute === null || m !== editingOriginalMinute)
  );
  if (isDuplicate) {
    return {
      ok: false,
      errorAr: `الدقيقة ${num} مضافة مسبقاً في جدول التبديلات.`,
    };
  }
  return { ok: true, minute: num };
}

/**
 * Computes the list of base substitution minutes (strictly < matchDurationMinutes)
 * for either Repeating Interval Mode or Manual Schedule Mode.
 */
export function computeBaseScheduleMinutes(
  matchDurationMinutes: number,
  scheduleMode: SubScheduleMode,
  intervalMinutes: number,
  manualMinutes: number[]
): number[] {
  const safeDuration = Math.max(MIN_MATCH_DURATION_MIN, Math.round(matchDurationMinutes));
  if (scheduleMode === 'interval') {
    const step = Math.max(MIN_SUB_INTERVAL_MIN, Math.round(intervalMinutes));
    const result: number[] = [];
    for (let m = step; m < safeDuration; m += step) {
      result.push(m);
    }
    return result;
  }

  const unique = new Set<number>();
  for (const raw of manualMinutes || []) {
    const m = Math.round(Number(raw));
    if (Number.isFinite(m) && m >= 1 && m < safeDuration) {
      unique.add(m);
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
}

/**
 * Builds or reconciles `ScheduledSubSlot[]` while preserving confirmation/snooze state
 * for matching `originalMinute` entries whenever possible.
 */
export function buildScheduledSubSlots(
  matchDurationMinutes: number,
  scheduleMode: SubScheduleMode,
  intervalMinutes: number,
  manualMinutes: number[],
  previousSlots: ScheduledSubSlot[] = [],
  pairingsByMinute?: Map<number, SubPlayerPairing>
): ScheduledSubSlot[] {
  const baseMinutes = computeBaseScheduleMinutes(
    matchDurationMinutes,
    scheduleMode,
    intervalMinutes,
    manualMinutes
  );

  const prevByOriginalMin = new Map<number, ScheduledSubSlot>();
  for (const prev of previousSlots) {
    if (!prevByOriginalMin.has(prev.originalMinute)) {
      prevByOriginalMin.set(prev.originalMinute, prev);
    }
  }

  return baseMinutes.map((min, idx) => {
    const existing = prevByOriginalMin.get(min);
    const pairing = pairingsByMinute?.get(min) ?? existing?.pairing;
    if (existing) {
      return {
        ...existing,
        index: idx + 1,
        pairing,
      };
    }
    return {
      id: `sub_slot_${min}`,
      index: idx + 1,
      originalMinute: min,
      effectiveMinute: min,
      effectiveTriggerSec: min * 60,
      totalSnoozeMinutes: 0,
      postponedCount: 0,
      status: 'pending',
      lastAlertedAtTriggerSec: null,
      confirmedAtSec: null,
      pairing,
    };
  });
}

export interface CreateDualMatchTimerOptions {
  matchDurationMinutes?: number;
  scheduleMode?: SubScheduleMode;
  intervalMinutes?: number;
  manualMinutes?: number[];
  pairingsByMinute?: Map<number, SubPlayerPairing>;
}

export function createDualMatchTimerState(
  opts: CreateDualMatchTimerOptions = {}
): DualMatchTimerState {
  const matchDurationMinutes =
    opts.matchDurationMinutes && opts.matchDurationMinutes >= MIN_MATCH_DURATION_MIN
      ? Math.round(opts.matchDurationMinutes)
      : 60;
  const scheduleMode: SubScheduleMode = opts.scheduleMode === 'manual' ? 'manual' : 'interval';
  const intervalMinutes =
    opts.intervalMinutes && opts.intervalMinutes >= MIN_SUB_INTERVAL_MIN
      ? Math.round(opts.intervalMinutes)
      : 10;
  const manualMinutes = Array.isArray(opts.manualMinutes)
    ? [...opts.manualMinutes]
    : [12, 25, 38, 50];

  const slots = buildScheduledSubSlots(
    matchDurationMinutes,
    scheduleMode,
    intervalMinutes,
    manualMinutes,
    [],
    opts.pairingsByMinute
  );

  return {
    matchDurationMinutes,
    scheduleMode,
    intervalMinutes,
    manualMinutes,
    slots,
    isRunning: false,
    isPaused: false,
    matchEnded: false,
    matchEndAlerted: false,
    matchEndBannerOpen: false,
    accumulatedElapsedMs: 0,
    runningSinceMs: null,
    activeAlertSlotId: null,
  };
}

/**
 * Computes exact elapsed milliseconds using wall-clock timestamps so backgrounded tabs
 * or locked screens never cause clock drift.
 */
export function computeElapsedMs(state: DualMatchTimerState, nowMs: number = Date.now()): number {
  const maxMs = Math.max(1, state.matchDurationMinutes) * 60 * 1000;
  const liveDelta =
    state.isRunning && state.runningSinceMs !== null ? Math.max(0, nowMs - state.runningSinceMs) : 0;
  const raw = Math.max(0, state.accumulatedElapsedMs + liveDelta);
  return Math.min(maxMs, raw);
}

/**
 * Advances and evaluates the shared match clock at `nowMs`.
 * Fires substitution alerts and match-end notification accurately with zero duplicates.
 */
export function tickDualMatchTimer(
  state: DualMatchTimerState,
  nowMs: number = Date.now()
): TimerTickResult {
  const totalDurationSec = Math.max(1, state.matchDurationMinutes) * 60;
  const maxMs = totalDurationSec * 1000;
  const elapsedMs = computeElapsedMs(state, nowMs);
  const elapsedSec = Math.min(totalDurationSec, Math.floor(elapsedMs / 1000));
  const remainingSec = Math.max(0, totalDurationSec - elapsedSec);
  const progressPct = Math.min(100, Math.max(0, (elapsedSec / totalDurationSec) * 100));

  const newlyTriggeredAlerts: TimerAlertEvent[] = [];
  let nextSlots = state.slots.map((s) => ({ ...s }));
  let nextActiveAlertSlotId = state.activeAlertSlotId;
  let isRunning = state.isRunning;
  let isPaused = state.isPaused;
  let matchEnded = state.matchEnded;
  let matchEndAlerted = state.matchEndAlerted;
  let matchEndBannerOpen = state.matchEndBannerOpen;
  let accumulatedElapsedMs = state.accumulatedElapsedMs;
  let runningSinceMs = state.runningSinceMs;

  // Check if match duration has ended
  if (elapsedSec >= totalDurationSec) {
    isRunning = false;
    isPaused = false;
    matchEnded = true;
    accumulatedElapsedMs = maxMs;
    runningSinceMs = null;
    nextActiveAlertSlotId = null;

    if (!matchEndAlerted) {
      matchEndAlerted = true;
      matchEndBannerOpen = true;
      newlyTriggeredAlerts.push({
        type: 'match_end',
        matchDurationMinutes: state.matchDurationMinutes,
      });
    }

    return {
      state: {
        ...state,
        slots: nextSlots,
        isRunning,
        isPaused,
        matchEnded,
        matchEndAlerted,
        matchEndBannerOpen,
        accumulatedElapsedMs,
        runningSinceMs,
        activeAlertSlotId: nextActiveAlertSlotId,
      },
      elapsedMs: maxMs,
      elapsedSec: totalDurationSec,
      remainingSec: 0,
      totalDurationSec,
      progressPct: 100,
      newlyTriggeredAlerts,
    };
  }

  // While match is before match end, evaluate substitution triggers against shared clock
  // Only evaluate new alert triggers when clock is running or has reached a trigger timestamp
  if (elapsedSec > 0) {
    const sortedIndices = nextSlots
      .map((_, i) => i)
      .sort((a, b) => nextSlots[a].effectiveTriggerSec - nextSlots[b].effectiveTriggerSec);

    for (const idx of sortedIndices) {
      const slot = nextSlots[idx];
      if (slot.status === 'confirmed') continue;
      // Never trigger any substitution scheduled at or after match end
      if (slot.effectiveTriggerSec >= totalDurationSec) continue;

      if (
        elapsedSec >= slot.effectiveTriggerSec &&
        slot.lastAlertedAtTriggerSec !== slot.effectiveTriggerSec
      ) {
        const updatedSlot: ScheduledSubSlot = {
          ...slot,
          status: 'active_alert',
          lastAlertedAtTriggerSec: slot.effectiveTriggerSec,
        };
        nextSlots[idx] = updatedSlot;
        nextActiveAlertSlotId = updatedSlot.id;
        newlyTriggeredAlerts.push({
          type: 'substitution',
          slot: updatedSlot,
        });
      }
    }
  }

  return {
    state: {
      ...state,
      slots: nextSlots,
      isRunning,
      isPaused,
      matchEnded,
      matchEndAlerted,
      matchEndBannerOpen,
      accumulatedElapsedMs,
      runningSinceMs,
      activeAlertSlotId: nextActiveAlertSlotId,
    },
    elapsedMs,
    elapsedSec,
    remainingSec,
    totalDurationSec,
    progressPct,
    newlyTriggeredAlerts,
  };
}

export function startOrResumeDualMatchTimer(
  state: DualMatchTimerState,
  nowMs: number = Date.now()
): DualMatchTimerState {
  if (state.isRunning) return state;
  const totalDurationMs = state.matchDurationMinutes * 60 * 1000;
  // If match had already ended and user presses start without resetting, restart from 0
  if (state.matchEnded || state.accumulatedElapsedMs >= totalDurationMs) {
    const fresh = resetDualMatchTimer(state);
    return {
      ...fresh,
      isRunning: true,
      isPaused: false,
      runningSinceMs: nowMs,
    };
  }
  return {
    ...state,
    isRunning: true,
    isPaused: false,
    runningSinceMs: nowMs,
  };
}

export function pauseDualMatchTimer(
  state: DualMatchTimerState,
  nowMs: number = Date.now()
): DualMatchTimerState {
  if (!state.isRunning) return state;
  const elapsedMs = computeElapsedMs(state, nowMs);
  return {
    ...state,
    isRunning: false,
    isPaused: true,
    accumulatedElapsedMs: elapsedMs,
    runningSinceMs: null,
  };
}

export function resetDualMatchTimer(
  state: DualMatchTimerState,
  pairingsByMinute?: Map<number, SubPlayerPairing>
): DualMatchTimerState {
  const freshSlots = buildScheduledSubSlots(
    state.matchDurationMinutes,
    state.scheduleMode,
    state.intervalMinutes,
    state.manualMinutes,
    [],
    pairingsByMinute
  );
  return {
    ...state,
    slots: freshSlots,
    isRunning: false,
    isPaused: false,
    matchEnded: false,
    matchEndAlerted: false,
    matchEndBannerOpen: false,
    accumulatedElapsedMs: 0,
    runningSinceMs: null,
    activeAlertSlotId: null,
  };
}

export function confirmSubstitutionSlot(
  state: DualMatchTimerState,
  slotId?: string | null,
  nowMs: number = Date.now()
): DualMatchTimerState {
  const targetId = slotId || state.activeAlertSlotId;
  if (!targetId) return state;
  const elapsedSec = Math.floor(computeElapsedMs(state, nowMs) / 1000);

  const nextSlots = state.slots.map((slot) => {
    if (slot.id !== targetId) return slot;
    return {
      ...slot,
      status: 'confirmed' as SubSlotStatus,
      confirmedAtSec: elapsedSec,
    };
  });

  const remainingActive = nextSlots.find((s) => s.status === 'active_alert');
  return {
    ...state,
    slots: nextSlots,
    activeAlertSlotId: remainingActive ? remainingActive.id : null,
  };
}

export function snoozeSubstitutionSlot(
  state: DualMatchTimerState,
  delayMinutes: number,
  slotId?: string | null,
  nowMs: number = Date.now()
): DualMatchTimerState {
  const safeDelay = Math.max(1, Math.min(60, Math.round(Number(delayMinutes) || 1)));
  const targetId = slotId || state.activeAlertSlotId;
  if (!targetId) return state;

  const elapsedSec = Math.floor(computeElapsedMs(state, nowMs) / 1000);

  const nextSlots = state.slots.map((slot) => {
    if (slot.id !== targetId) return slot;
    const baseSec = Math.max(slot.effectiveTriggerSec, elapsedSec);
    const nextTriggerSec = baseSec + safeDelay * 60;
    const nextTotalSnooze = slot.totalSnoozeMinutes + safeDelay;
    const nextEffectiveMin = Math.floor(nextTriggerSec / 60);
    return {
      ...slot,
      totalSnoozeMinutes: nextTotalSnooze,
      postponedCount: slot.postponedCount + 1,
      effectiveTriggerSec: nextTriggerSec,
      effectiveMinute: nextEffectiveMin,
      status: 'snoozed' as SubSlotStatus,
    };
  });

  const remainingActive = nextSlots.find((s) => s.status === 'active_alert');
  return {
    ...state,
    slots: nextSlots,
    activeAlertSlotId: remainingActive ? remainingActive.id : null,
  };
}

export function setMatchDuration(
  state: DualMatchTimerState,
  newDurationMinutes: number,
  pairingsByMinute?: Map<number, SubPlayerPairing>,
  nowMs: number = Date.now()
): DualMatchTimerState {
  const valid = validateMatchDurationMinutes(newDurationMinutes);
  if (!valid.ok) return state;

  const elapsedMs = computeElapsedMs(state, nowMs);
  const nextSlots = buildScheduledSubSlots(
    valid.minutes,
    state.scheduleMode,
    state.intervalMinutes,
    state.manualMinutes,
    state.slots,
    pairingsByMinute
  );

  const nextMaxMs = valid.minutes * 60 * 1000;
  const clampedElapsedMs = Math.min(elapsedMs, nextMaxMs);
  const matchEnded = clampedElapsedMs >= nextMaxMs;

  return {
    ...state,
    matchDurationMinutes: valid.minutes,
    slots: nextSlots,
    accumulatedElapsedMs: clampedElapsedMs,
    runningSinceMs: state.isRunning && !matchEnded ? nowMs : null,
    isRunning: state.isRunning && !matchEnded,
    matchEnded,
    matchEndAlerted: matchEnded ? state.matchEndAlerted : false,
    matchEndBannerOpen: matchEnded ? state.matchEndBannerOpen : false,
  };
}

export function setScheduleMode(
  state: DualMatchTimerState,
  mode: SubScheduleMode,
  pairingsByMinute?: Map<number, SubPlayerPairing>
): DualMatchTimerState {
  const safeMode: SubScheduleMode = mode === 'manual' ? 'manual' : 'interval';
  const nextSlots = buildScheduledSubSlots(
    state.matchDurationMinutes,
    safeMode,
    state.intervalMinutes,
    state.manualMinutes,
    state.slots,
    pairingsByMinute
  );
  const activeStillExists = nextSlots.some(
    (s) => s.id === state.activeAlertSlotId && s.status === 'active_alert'
  );
  return {
    ...state,
    scheduleMode: safeMode,
    slots: nextSlots,
    activeAlertSlotId: activeStillExists ? state.activeAlertSlotId : null,
  };
}

export function setSubIntervalMinutes(
  state: DualMatchTimerState,
  newIntervalMinutes: number,
  pairingsByMinute?: Map<number, SubPlayerPairing>
): DualMatchTimerState {
  const valid = validateSubIntervalMinutes(newIntervalMinutes);
  if (!valid.ok) return state;

  const nextSlots = buildScheduledSubSlots(
    state.matchDurationMinutes,
    'interval',
    valid.minutes,
    state.manualMinutes,
    state.slots,
    pairingsByMinute
  );
  return {
    ...state,
    scheduleMode: 'interval',
    intervalMinutes: valid.minutes,
    slots: nextSlots,
    activeAlertSlotId: null,
  };
}

export function addManualSubMinute(
  state: DualMatchTimerState,
  rawMinute: unknown,
  pairingsByMinute?: Map<number, SubPlayerPairing>
): { ok: true; state: DualMatchTimerState } | { ok: false; errorAr: string } {
  const valid = validateManualSubMinute(
    rawMinute,
    state.matchDurationMinutes,
    state.manualMinutes,
    null
  );
  if (!valid.ok) return valid;

  const nextManual = [...state.manualMinutes, valid.minute].sort((a, b) => a - b);
  const nextSlots = buildScheduledSubSlots(
    state.matchDurationMinutes,
    'manual',
    state.intervalMinutes,
    nextManual,
    state.slots,
    pairingsByMinute
  );
  return {
    ok: true,
    state: {
      ...state,
      scheduleMode: 'manual',
      manualMinutes: nextManual,
      slots: nextSlots,
    },
  };
}

export function editManualSubMinute(
  state: DualMatchTimerState,
  originalMinuteToEdit: number,
  newRawMinute: unknown,
  pairingsByMinute?: Map<number, SubPlayerPairing>
): { ok: true; state: DualMatchTimerState } | { ok: false; errorAr: string } {
  const valid = validateManualSubMinute(
    newRawMinute,
    state.matchDurationMinutes,
    state.manualMinutes,
    originalMinuteToEdit
  );
  if (!valid.ok) return valid;

  const nextManual = state.manualMinutes
    .map((m) => (m === originalMinuteToEdit ? valid.minute : m))
    .sort((a, b) => a - b);

  // Drop old slot state for edited minute so it gets a clean trigger at new minute
  const preservedSlots = state.slots.filter((s) => s.originalMinute !== originalMinuteToEdit);
  const nextSlots = buildScheduledSubSlots(
    state.matchDurationMinutes,
    'manual',
    state.intervalMinutes,
    nextManual,
    preservedSlots,
    pairingsByMinute
  );

  return {
    ok: true,
    state: {
      ...state,
      scheduleMode: 'manual',
      manualMinutes: nextManual,
      slots: nextSlots,
    },
  };
}

export function deleteManualSubMinute(
  state: DualMatchTimerState,
  minuteToDelete: number,
  pairingsByMinute?: Map<number, SubPlayerPairing>
): DualMatchTimerState {
  const nextManual = state.manualMinutes.filter((m) => m !== minuteToDelete);
  const preservedSlots = state.slots.filter((s) => s.originalMinute !== minuteToDelete);
  const nextSlots = buildScheduledSubSlots(
    state.matchDurationMinutes,
    'manual',
    state.intervalMinutes,
    nextManual,
    preservedSlots,
    pairingsByMinute
  );
  const activeStillExists = nextSlots.some(
    (s) => s.id === state.activeAlertSlotId && s.status === 'active_alert'
  );
  return {
    ...state,
    scheduleMode: 'manual',
    manualMinutes: nextManual,
    slots: nextSlots,
    activeAlertSlotId: activeStillExists ? state.activeAlertSlotId : null,
  };
}

export function getNextScheduledSub(
  state: DualMatchTimerState,
  nowMs: number = Date.now()
): NextScheduledSubInfo | null {
  const totalDurationSec = state.matchDurationMinutes * 60;
  const elapsedSec = Math.floor(computeElapsedMs(state, nowMs) / 1000);
  if (state.matchEnded || elapsedSec >= totalDurationSec) return null;

  const candidates = state.slots
    .filter((s) => s.status !== 'confirmed' && s.effectiveTriggerSec < totalDurationSec)
    .sort((a, b) => a.effectiveTriggerSec - b.effectiveTriggerSec);

  for (const slot of candidates) {
    if (slot.status === 'active_alert' || slot.effectiveTriggerSec >= elapsedSec) {
      const secondsUntil = Math.max(0, slot.effectiveTriggerSec - elapsedSec);
      return {
        slot,
        secondsUntil,
        isPostponed: slot.postponedCount > 0,
        isDueNow: elapsedSec >= slot.effectiveTriggerSec,
      };
    }
  }
  return null;
}

export function serializeDualMatchTimerState(state: DualMatchTimerState): string {
  return JSON.stringify(state);
}

export function deserializeDualMatchTimerState(raw: string | null | undefined): DualMatchTimerState | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DualMatchTimerState>;
    const durCheck = validateMatchDurationMinutes(parsed.matchDurationMinutes);
    const intCheck = validateSubIntervalMinutes(parsed.intervalMinutes);
    if (!durCheck.ok || !intCheck.ok) return null;

    const scheduleMode: SubScheduleMode = parsed.scheduleMode === 'manual' ? 'manual' : 'interval';
    const manualMinutes = Array.isArray(parsed.manualMinutes)
      ? parsed.manualMinutes
          .map((m) => Math.round(Number(m)))
          .filter((m) => Number.isFinite(m) && m >= 1 && m < durCheck.minutes)
      : [12, 25, 38, 50];

    const restoredSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
    const slots = buildScheduledSubSlots(
      durCheck.minutes,
      scheduleMode,
      intCheck.minutes,
      manualMinutes,
      restoredSlots
    );

    return {
      matchDurationMinutes: durCheck.minutes,
      scheduleMode,
      intervalMinutes: intCheck.minutes,
      manualMinutes,
      slots,
      isRunning: Boolean(parsed.isRunning),
      isPaused: Boolean(parsed.isPaused),
      matchEnded: Boolean(parsed.matchEnded),
      matchEndAlerted: Boolean(parsed.matchEndAlerted),
      matchEndBannerOpen: Boolean(parsed.matchEndBannerOpen),
      accumulatedElapsedMs: Math.max(0, Number(parsed.accumulatedElapsedMs) || 0),
      runningSinceMs:
        parsed.isRunning && typeof parsed.runningSinceMs === 'number' && Number.isFinite(parsed.runningSinceMs)
          ? parsed.runningSinceMs
          : null,
      activeAlertSlotId: typeof parsed.activeAlertSlotId === 'string' ? parsed.activeAlertSlotId : null,
    };
  } catch {
    return null;
  }
}
