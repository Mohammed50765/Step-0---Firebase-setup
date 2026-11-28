import { escapeHtml } from '../security';
import {
  BLIND_SIDE_OPTIONS,
  evaluateBlindSideDecision,
  generateBlindSideScenario,
  getDifficultyTimings,
  summarizeBlindSideSession,
  type BlindSideDecisionId,
  type BlindSideDifficulty,
  type BlindSideRoundOutcome,
  type BlindSideScenario,
} from '../engine/blindSideRadar';
import {
  GTO_DUEL_ACTIONS,
  computePredictabilityAssessment,
  createGtoDuelState,
  stepGtoDuel,
  summarizeGtoDuelSession,
  type GtoDuelAction,
  type GtoDuelRoundRecord,
  type GtoDuelSessionState,
} from '../engine/gtoDuel';

import type { PitWallRotationController } from './pitWallUI';
import { getSharedAudioContext } from '../ui/entryAudio';

export type TacticalLabTab = 'radar' | 'ghost' | 'duel' | 'pitwall';

export interface TacticalLabModalOptions {
  toast?: (msg: string, isErr?: boolean) => void;
  isXrayEnabled?: () => boolean;
  onToggleXray?: () => void;
  onOpenGhostTheater?: () => void;
  onCopyGhostLink?: () => void;
  onExportGhostWebm?: () => void;
  getGhostSummary?: () => { title: string; framesCount: number; durationSec: number } | null;
  pitWallController?: PitWallRotationController;
}

const GTO_LOCAL_HISTORY_KEY = 'maydan_gto_duel_history_v1';

interface StoredGtoHistoryEntry {
  ts: number;
  rounds: number;
  winRatePct: number;
  predictabilityPct: number | null;
}

function loadGtoHistory(): StoredGtoHistoryEntry[] {
  try {
    const raw = localStorage.getItem(GTO_LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveGtoHistory(entry: StoredGtoHistoryEntry): void {
  try {
    const prev = loadGtoHistory();
    prev.unshift(entry);
    localStorage.setItem(GTO_LOCAL_HISTORY_KEY, JSON.stringify(prev.slice(0, 8)));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Plays an optional spatial Web Audio cue (left/right stereo pan) for Blind-Side Radar.
 * Reuses a shared AudioContext to prevent Web Audio context leaks, falls back cleanly
 * to mono if StereoPannerNode is unsupported, and silently ignores blocked audio.
 */
function playBlindSideSpatialCue(pan: number, urgency: 'low' | 'medium' | 'high'): void {
  try {
    const ac = getSharedAudioContext();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = urgency === 'high' ? 'triangle' : 'sine';
    const baseFreq = urgency === 'high' ? 620 : urgency === 'medium' ? 500 : 420;
    osc.frequency.setValueAtTime(baseFreq, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, ac.currentTime + 0.14);

    gain.gain.setValueAtTime(0.09, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.24);

    osc.connect(gain);
    if (typeof ac.createStereoPanner === 'function') {
      const panner = ac.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ac.currentTime);
      gain.connect(panner);
      panner.connect(ac.destination);
    } else {
      gain.connect(ac.destination);
    }
    osc.start();
    osc.stop(ac.currentTime + 0.26);
  } catch {
    // Graceful no-op when audio is restricted
  }
}

/**
 * Opens the unified Royal Tactical Intelligence Lab modal hosting all 5 systems:
 * - Header quick-toggle for Feature 01: Dominance X-Ray (live on pitch)
 * - Tab 1: Blind-Side Radar (Scanning & Decision Drill)
 * - Tab 2: Ghost Play Studio (Theater, Challenge Mode, Ghost Link, Local WebM)
 * - Tab 3: GTO Duel (Adaptive 1v1 Reading & Anti-Pattern Drill)
 * - Tab 4: Pit-Wall Rotation Room (Live Fair Subs, Fatigue Curve & Offline Pit Mode)
 */
export function openTacticalLabModal(
  initialTab: TacticalLabTab = 'radar',
  toastOrOptions?: ((msg: string, isErr?: boolean) => void) | TacticalLabModalOptions
): void {
  const opts: TacticalLabModalOptions =
    typeof toastOrOptions === 'function' ? { toast: toastOrOptions } : toastOrOptions || {};
  const toast = opts.toast;

  const existing = document.getElementById('maydanTacticalLabModal');
  if (existing) existing.remove();

  let activeTab: TacticalLabTab = initialTab;

  // --- Feature 02 (Blind-Side Radar) State ---
  let radarDiff: BlindSideDifficulty = 1;
  let radarAutoStep = true;
  let radarSoundOn = true;
  let radarPhase: 'idle' | 'peek' | 'decide' | 'reveal' | 'report' = 'idle';
  let radarScenario: BlindSideScenario | null = null;
  let radarRecentKeys: string[] = [];
  let radarOutcomes: BlindSideRoundOutcome[] = [];
  let radarLastOutcome: BlindSideRoundOutcome | null = null;
  let radarDecisionStartTs = 0;
  let radarTimerId: number | null = null;
  let radarCountdownRaf: number | null = null;
  const RADAR_SESSION_ROUNDS = 5;

  // --- Feature 04 (GTO Duel) State ---
  let duelState: GtoDuelSessionState = createGtoDuelState();
  let duelLastRecord: GtoDuelRoundRecord | null = null;
  let duelShowReport = false;

  const modal = document.createElement('div');
  modal.id = 'maydanTacticalLabModal';
  modal.className = 'tac-lab-modal-backdrop';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'مختبر الذكاء التكتيكي — ميدان 6v6');

  const xrayOn = Boolean(opts.isXrayEnabled?.());

  modal.innerHTML = `
    <div class="tac-lab-modal-card" dir="rtl" style="max-width:560px;">
      <div class="tac-lab-modal-head">
        <div>
          <div style="font-size:0.7rem;color:#facc15;font-weight:800;">🧠 مختبر الذكاء التكتيكي • 5 منظومات محلية 100%</div>
          <h3 style="margin:2px 0 0;font-size:1.04rem;color:#fff;">ميدان <bdi dir="ltr">6v6</bdi> — المختبر التكتيكي الشامل</h3>
        </div>
        <div class="row" style="gap:6px;align-items:center;">
          ${
            opts.onToggleXray
              ? `<button type="button" id="btnLabModalXray" class="tac-xray-btn ${xrayOn ? 'active' : ''}" aria-pressed="${xrayOn}" style="min-height:34px;padding:4px 10px;font-size:0.73rem;">🔬 أشعة X: ${xrayOn ? 'مفعّلة' : 'تشغيل'}</button>`
              : ''
          }
          <button type="button" id="btnCloseTacticalLab" class="icon-btn" aria-label="إغلاق المختبر">✕</button>
        </div>
      </div>

      <div class="tac-lab-modal-tabs" role="tablist" aria-label="أدوات مختبر الذكاء التكتيكي">
        <button type="button" data-lab-tab="radar" class="tac-lab-modal-tab ${activeTab === 'radar' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'radar'}">👁️ رادار العمياء</button>
        <button type="button" data-lab-tab="ghost" class="tac-lab-modal-tab ${activeTab === 'ghost' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'ghost'}">👻 خطط الشبح</button>
        <button type="button" data-lab-tab="duel" class="tac-lab-modal-tab ${activeTab === 'duel' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'duel'}">⚔️ مواجهة 1v1</button>
        <button type="button" data-lab-tab="pitwall" class="tac-lab-modal-tab ${activeTab === 'pitwall' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'pitwall'}">⏱️ غرفة الدكة</button>
      </div>

      <div id="tacLabBody"></div>
    </div>
  `;

  document.body.appendChild(modal);
  const body = modal.querySelector('#tacLabBody') as HTMLElement;

  const clearRadarTimers = () => {
    if (radarTimerId !== null) {
      window.clearTimeout(radarTimerId);
      radarTimerId = null;
    }
    if (radarCountdownRaf !== null) {
      cancelAnimationFrame(radarCountdownRaf);
      radarCountdownRaf = null;
    }
  };

  const renderRadarPitchSvg = (sc: BlindSideScenario, maskActive: boolean): string => {
    const W = 320;
    const H = 250;
    const px = (x: number) => 16 + (x / 100) * (W - 32);
    const py = (y: number) => 16 + (y / 100) * (H - 32);
    const maskedOpp = new Set(maskActive ? sc.maskedOppIndices : []);
    const maskedOur = new Set(maskActive ? sc.maskedOurIndices : []);

    const parts: string[] = [];
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#083516"/>
      <rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.4"/>
      <line x1="16" y1="${H / 2}" x2="${W - 16}" y2="${H / 2}" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
      <circle cx="${W / 2}" cy="${H / 2}" r="24" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>`);

    // Carrier scan cone visual during peek/decide
    const cPt = sc.our[sc.carrierIdx];
    const cx = px(cPt.x);
    const cy = py(cPt.y);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="22" fill="rgba(250,204,21,0.14)" stroke="#facc15" stroke-width="1.2" stroke-dasharray="3 3"/>`
    );

    // Opponents
    sc.opp.forEach((p, idx) => {
      if (maskedOpp.has(idx)) {
        // Show subtle fog question ring only in peek->decide transition so user knows blind-side was hidden
        parts.push(
          `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="10" fill="rgba(15,23,42,0.45)" stroke="rgba(251,113,133,0.4)" stroke-dasharray="2 3"/>
           <text x="${px(p.x).toFixed(1)}" y="${(py(p.y) + 3.5).toFixed(1)}" text-anchor="middle" fill="rgba(251,113,133,0.65)" font-size="10" font-weight="900">؟</text>`
        );
        return;
      }
      const isBlind = sc.maskedOppIndices.includes(idx);
      parts.push(
        `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="10.5" fill="${isBlind ? '#7f1d1d' : '#1e293b'}" stroke="${isBlind ? '#fb7185' : '#94a3b8'}" stroke-width="1.8"/>
         <text x="${px(p.x).toFixed(1)}" y="${(py(p.y) + 3.5).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="9" font-weight="800">${idx + 1}</text>`
      );
    });

    // Our players
    sc.our.forEach((p, idx) => {
      if (maskedOur.has(idx)) return;
      const isCarrier = idx === sc.carrierIdx;
      parts.push(
        `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${isCarrier ? 12 : 10.5}" fill="${isCarrier ? '#422006' : '#0f172a'}" stroke="#facc15" stroke-width="${isCarrier ? 2.6 : 1.7}"/>
         <text x="${px(p.x).toFixed(1)}" y="${(py(p.y) + 3.5).toFixed(1)}" text-anchor="middle" fill="#fef08a" font-size="9" font-weight="800">${isCarrier ? '★' : idx + 1}</text>`
      );
    });

    // Ball next to carrier
    parts.push(
      `<circle cx="${(cx + 10).toFixed(1)}" cy="${(cy - 6).toFixed(1)}" r="4.8" fill="#fff" stroke="#111827" stroke-width="1.2"/>`
    );

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:340px;margin:0 auto;display:block;border-radius:12px;border:1px solid rgba(250,204,21,0.28);" role="img" aria-label="ملعب تمرين رادار الزاوية العمياء">${parts.join('')}</svg>`;
  };

  const startRadarRound = () => {
    clearRadarTimers();
    if (radarAutoStep && radarOutcomes.length >= 2) {
      const recentAcc = radarOutcomes.slice(-2).filter((o) => o.correct).length;
      if (recentAcc === 2 && radarDiff < 3) radarDiff = (radarDiff + 1) as BlindSideDifficulty;
    }
    const sc = generateBlindSideScenario(radarDiff, radarRecentKeys);
    radarScenario = sc;
    radarRecentKeys.push(sc.scenarioKey);
    radarLastOutcome = null;
    radarPhase = 'peek';
    renderActiveTab();

    if (radarSoundOn) {
      playBlindSideSpatialCue(sc.audioCue.pan, sc.audioCue.urgency);
    }

    // Animate peek bar
    const peekStart = performance.now();
    const animPeek = (now: number) => {
      if (radarPhase !== 'peek') return;
      const pct = Math.max(0, 100 - ((now - peekStart) / sc.peekMs) * 100);
      const bar = body.querySelector<HTMLElement>('#radarTimerFill');
      if (bar) bar.style.width = `${pct.toFixed(1)}%`;
      if (now - peekStart < sc.peekMs) {
        radarCountdownRaf = requestAnimationFrame(animPeek);
      }
    };
    radarCountdownRaf = requestAnimationFrame(animPeek);

    radarTimerId = window.setTimeout(() => {
      radarPhase = 'decide';
      radarDecisionStartTs = performance.now();
      renderActiveTab();

      const decStart = performance.now();
      const animDec = (now: number) => {
        if (radarPhase !== 'decide') return;
        const pct = Math.max(0, 100 - ((now - decStart) / sc.decisionMs) * 100);
        const bar = body.querySelector<HTMLElement>('#radarTimerFill');
        if (bar) bar.style.width = `${pct.toFixed(1)}%`;
        if (now - decStart < sc.decisionMs) {
          radarCountdownRaf = requestAnimationFrame(animDec);
        }
      };
      radarCountdownRaf = requestAnimationFrame(animDec);

      radarTimerId = window.setTimeout(() => {
        submitRadarChoice(null);
      }, sc.decisionMs);
    }, sc.peekMs);
  };

  const submitRadarChoice = (choice: BlindSideDecisionId | null) => {
    if (radarPhase !== 'decide' || !radarScenario) return;
    clearRadarTimers();
    const elapsed = choice ? performance.now() - radarDecisionStartTs : radarScenario.decisionMs;
    const outcome = evaluateBlindSideDecision(radarScenario, choice, elapsed);
    radarOutcomes.push(outcome);
    radarLastOutcome = outcome;
    radarPhase = 'reveal';
    renderActiveTab();
  };

  const renderRadarView = () => {
    const timings = getDifficultyTimings(radarDiff);
    if (radarPhase === 'report') {
      const summary = summarizeBlindSideSession(radarOutcomes);
      body.innerHTML = `
        <div class="item-box" style="border-color:rgba(250,204,21,0.45);">
          <div style="font-weight:900;color:#facc15;font-size:0.95rem;margin-bottom:8px;">📊 تقرير جلسة رادار الزاوية العمياء</div>
          <div class="grid-3" style="gap:6px;margin-bottom:10px;text-align:center;">
            <div class="item-box" style="margin:0;">
              <div class="muted" style="font-size:0.7rem;">الدقة</div>
              <div dir="ltr" style="font-size:1.15rem;font-weight:900;color:#facc15;">${summary.accuracyPct}%</div>
            </div>
            <div class="item-box" style="margin:0;">
              <div class="muted" style="font-size:0.7rem;">متوسط الاستجابة</div>
              <div dir="ltr" style="font-size:1.15rem;font-weight:900;color:#4ade80;">${summary.avgResponseMs ? (summary.avgResponseMs / 1000).toFixed(2) + 's' : '--'}</div>
            </div>
            <div class="item-box" style="margin:0;">
              <div class="muted" style="font-size:0.7rem;">القرارات الصحيحة</div>
              <div dir="ltr" style="font-size:1.15rem;font-weight:900;color:#fff;">${summary.correctCount}/${summary.totalRounds}</div>
            </div>
          </div>
          <div style="font-size:0.8rem;margin-bottom:8px;line-height:1.55;">
            <strong style="color:#fda4af;">أبرز نقطة للتحسين:</strong> ${escapeHtml(summary.topMistakeAr)}
          </div>
          <div class="muted" style="font-size:0.7rem;margin-bottom:10px;line-height:1.5;">ℹ️ ${escapeHtml(summary.disclaimerAr)}</div>
          <button type="button" id="btnRadarRestart" class="btn-primary" style="width:100%;">🔁 بدء جلسة جديدة (${RADAR_SESSION_ROUNDS} مواقف)</button>
        </div>
      `;
      body.querySelector('#btnRadarRestart')?.addEventListener('click', () => {
        radarOutcomes = [];
        radarPhase = 'idle';
        startRadarRound();
      });
      return;
    }

    if (radarPhase === 'idle' || !radarScenario) {
      body.innerHTML = `
        <div class="item-box" style="border-color:rgba(250,204,21,0.35);">
          <div style="font-weight:900;color:#facc15;font-size:0.92rem;margin-bottom:5px;">👁️ تمرين المسح البصري قبل الاستلام (Blind-Side Radar)</div>
          <p class="muted" style="font-size:0.78rem;line-height:1.6;margin-bottom:10px;">
            ستظهر لك لقطة تكتيكية لـ <strong style="color:#fff;">${(timings.peekMs / 1000).toFixed(1)} ثانية</strong> ثم يُخفى المدافع القادم من الزاوية العمياء لتتخذ أسرع قرار صحيح تحت الضغط.
          </p>
          <div style="margin-bottom:8px;">
            <div class="muted" style="font-size:0.72rem;margin-bottom:4px;">مستوى الصعوبة:</div>
            <div class="row" style="gap:6px;">
              ${([1, 2, 3] as BlindSideDifficulty[])
                .map(
                  (lvl) =>
                    `<button type="button" data-radar-diff="${lvl}" class="tac-pill ${radarDiff === lvl ? 'active' : ''}">${getDifficultyTimings(lvl).labelAr}</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="row between" style="gap:8px;margin-bottom:10px;font-size:0.76rem;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" id="chkRadarSound" ${radarSoundOn ? 'checked' : ''} />
              <span>🔊 تنبيه صوتي مكاني لجهة الضغط</span>
            </label>
            <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" id="chkRadarAuto" ${radarAutoStep ? 'checked' : ''} />
              <span>تدرّج تلقائي بالصعوبة</span>
            </label>
          </div>
          <button type="button" id="btnRadarStart" class="btn-primary" style="width:100%;">▶ ابدأ التمرين (${RADAR_SESSION_ROUNDS} مواقف)</button>
        </div>
      `;
      body.querySelectorAll<HTMLButtonElement>('[data-radar-diff]').forEach((b) => {
        b.addEventListener('click', () => {
          radarDiff = Number(b.dataset.radarDiff) as BlindSideDifficulty;
          renderRadarView();
        });
      });
      body.querySelector('#chkRadarSound')?.addEventListener('change', (e) => {
        radarSoundOn = (e.target as HTMLInputElement).checked;
      });
      body.querySelector('#chkRadarAuto')?.addEventListener('change', (e) => {
        radarAutoStep = (e.target as HTMLInputElement).checked;
      });
      body.querySelector('#btnRadarStart')?.addEventListener('click', () => {
        radarOutcomes = [];
        startRadarRound();
      });
      return;
    }

    const sc = radarScenario;
    const roundNum = Math.min(RADAR_SESSION_ROUNDS, radarOutcomes.length + (radarPhase === 'reveal' ? 0 : 1));
    const phaseLabel =
      radarPhase === 'peek'
        ? '👁️ امسح الملعب الآن — احفظ موقع الضغط!'
        : radarPhase === 'decide'
          ? '⚡ أُخفي الخصم — اختر قرارك فوراً!'
          : radarLastOutcome?.correct
            ? '✅ قرار ممتاز!'
            : radarLastOutcome?.partial
              ? '🟡 قرار مقبول'
              : '✕ راجع الموقف التكتيكي';

    body.innerHTML = `
      <div class="row between" style="margin-bottom:6px;font-size:0.76rem;">
        <span style="color:#facc15;font-weight:800;">الموقف ${roundNum} / ${RADAR_SESSION_ROUNDS} • ${getDifficultyTimings(sc.difficulty).labelAr}</span>
        <span class="muted">${escapeHtml(sc.titleAr)}</span>
      </div>

      <div style="height:6px;background:rgba(255,255,255,0.1);border-radius:99px;overflow:hidden;margin-bottom:8px;">
        <div id="radarTimerFill" style="height:100%;width:${radarPhase === 'reveal' ? '0%' : '100%'};background:${radarPhase === 'decide' ? '#fb7185' : '#facc15'};transition:background 0.2s;"></div>
      </div>

      <div style="text-align:center;font-weight:800;font-size:0.84rem;color:${radarPhase === 'decide' ? '#fde047' : '#f8fafc'};margin-bottom:6px;">
        ${phaseLabel}
      </div>

      ${renderRadarPitchSvg(sc, radarPhase === 'decide')}

      <div class="muted" style="font-size:0.74rem;text-align:center;margin:6px 0 8px;">${escapeHtml(sc.situationPromptAr)}</div>

      ${
        radarPhase === 'decide'
          ? `<div class="grid-2" style="gap:7px;">
              ${BLIND_SIDE_OPTIONS.map(
                (opt) =>
                  `<button type="button" data-radar-choice="${opt.id}" class="btn-amber" style="min-height:44px;font-size:0.8rem;line-height:1.3;">${escapeHtml(opt.shortAr)}</button>`
              ).join('')}
            </div>`
          : radarPhase === 'peek'
            ? `<div class="muted" style="text-align:center;font-size:0.75rem;padding:8px;">تفتح أزرار القرار تلقائياً بعد انتهاء نافذة المسح...</div>`
            : `<div class="item-box" style="margin-top:6px;border-color:${radarLastOutcome?.correct ? 'rgba(74,222,128,0.5)' : 'rgba(251,113,133,0.45)'};">
                <div style="font-size:0.8rem;line-height:1.55;color:#f4f4f5;margin-bottom:8px;">${escapeHtml(radarLastOutcome?.feedbackAr || '')}</div>
                <div class="grid-2" style="gap:6px;">
                  <button type="button" id="btnRadarNext" class="btn-primary">${
                    radarOutcomes.length >= RADAR_SESSION_ROUNDS ? '📊 عرض التقرير النهائي' : 'التالي ←'
                  }</button>
                  <button type="button" id="btnRadarFinishNow">إنهاء وعرض التقرير</button>
                </div>
              </div>`
      }
    `;

    body.querySelectorAll<HTMLButtonElement>('[data-radar-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        submitRadarChoice(btn.dataset.radarChoice as BlindSideDecisionId);
      });
    });
    body.querySelector('#btnRadarNext')?.addEventListener('click', () => {
      if (radarOutcomes.length >= RADAR_SESSION_ROUNDS) {
        radarPhase = 'report';
        renderRadarView();
      } else {
        startRadarRound();
      }
    });
    body.querySelector('#btnRadarFinishNow')?.addEventListener('click', () => {
      radarPhase = 'report';
      renderRadarView();
    });
  };

  // --- Feature 04 (GTO Duel) Renderer ---
  const renderDuelArenaSvg = (): string => {
    const W = 320;
    const H = 195;
    const stance = duelState.stance;
    const defX = W / 2 + stance.bodyShadeX * 26;
    const defY = 74;
    const attX = W / 2;
    const attY = 148;

    // Shaded closed lane cone driven directly by defender anticipation
    const closedX =
      stance.anticipatedMove === 'inside_cut'
        ? W / 2 + 56
        : stance.anticipatedMove === 'outside_line'
          ? W / 2 - 56
          : W / 2;

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:340px;margin:0 auto 8px;display:block;border-radius:12px;border:1px solid rgba(250,204,21,0.28);" role="img" aria-label="ساحة مواجهة 1 ضد 1 التكتيكية">
        <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#083516"/>
        <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.3"/>
        <rect x="${W / 2 - 44}" y="14" width="88" height="28" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.3"/>

        <!-- Closed lane shadow showing defender stance lean -->
        <polygon points="${defX.toFixed(1)},${defY} ${(closedX - 24).toFixed(1)},16 ${(closedX + 24).toFixed(1)},16" fill="rgba(244,63,94,0.22)" stroke="rgba(251,113,133,0.45)" stroke-dasharray="3 3"/>

        <!-- Defender body bar rotated by stanceDeg -->
        <g transform="translate(${defX.toFixed(1)}, ${defY}) rotate(${stance.stanceDeg})">
          <rect x="-18" y="-5" width="36" height="10" rx="5" fill="#7f1d1d" stroke="#fb7185" stroke-width="1.8"/>
          <circle cx="0" cy="0" r="8" fill="#1e293b" stroke="#fb7185" stroke-width="1.8"/>
        </g>
        <text x="${defX.toFixed(1)}" y="${defY - 14}" text-anchor="middle" fill="#fda4af" font-size="9" font-weight="800">المدافع المتكيّف</text>

        <!-- Attacker (you) + ball -->
        <circle cx="${attX}" cy="${attY}" r="13" fill="#0f172a" stroke="#facc15" stroke-width="2.4"/>
        <text x="${attX}" y="${attY + 3.5}" text-anchor="middle" fill="#fef08a" font-size="9.5" font-weight="900">أنت</text>
        <circle cx="${attX + 14}" cy="${attY - 6}" r="5" fill="#fff" stroke="#111827" stroke-width="1.2"/>
      </svg>
    `;
  };

  const renderDuelView = () => {
    const pred = computePredictabilityAssessment(duelState.history);

    if (duelShowReport) {
      const report = summarizeGtoDuelSession(duelState);
      const historyList = loadGtoHistory();
      body.innerHTML = `
        <div class="item-box" style="border-color:rgba(250,204,21,0.45);">
          <div style="font-weight:900;color:#facc15;font-size:0.95rem;margin-bottom:8px;">📊 تقرير مواجهة 1 ضد 1 والتنويع</div>
          <div class="grid-3" style="gap:6px;margin-bottom:10px;text-align:center;">
            <div class="item-box" style="margin:0;">
              <div class="muted" style="font-size:0.7rem;">نسبة الاختراق</div>
              <div dir="ltr" style="font-size:1.15rem;font-weight:900;color:#4ade80;">${report.winRatePct}%</div>
            </div>
            <div class="item-box" style="margin:0;">
              <div class="muted" style="font-size:0.7rem;">قابلية التوقّع</div>
              <div dir="ltr" style="font-size:1.05rem;font-weight:900;color:#facc15;">${
                report.predictability.sufficientSample ? `${report.predictability.predictabilityPct}%` : 'عينة أولية'
              }</div>
            </div>
            <div class="item-box" style="margin:0;">
              <div class="muted" style="font-size:0.7rem;">الجولات</div>
              <div dir="ltr" style="font-size:1.15rem;font-weight:900;color:#fff;">${report.totalRounds}</div>
            </div>
          </div>

          <div style="font-size:0.79rem;line-height:1.55;margin-bottom:6px;">${escapeHtml(report.repeatedPatternAr)}</div>
          <div style="font-size:0.79rem;line-height:1.55;color:#fde047;margin-bottom:8px;">💡 ${escapeHtml(report.diversificationTipAr)}</div>

          <div style="margin-bottom:8px;">
            ${GTO_DUEL_ACTIONS.map((a) => {
              const cnt = report.actionCounts[a.id];
              const pct = report.totalRounds ? Math.round((cnt / report.totalRounds) * 100) : 0;
              return `<div style="margin-bottom:4px;font-size:0.74rem;">
                <div class="row between"><span>${escapeHtml(a.labelAr)}</span><span dir="ltr">${cnt} (${pct}%)</span></div>
                <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:#facc15;"></div>
                </div>
              </div>`;
            }).join('')}
          </div>

          ${
            historyList.length
              ? `<div class="muted" style="font-size:0.7rem;margin-bottom:8px;">السجل المحلي المحفوظ: ${historyList.length} جلسات سابقة (محلياً على جهازك فقط).</div>`
              : ''
          }
          <div class="muted" style="font-size:0.69rem;margin-bottom:10px;">ℹ️ ${escapeHtml(report.disclaimerAr)}</div>
          <div class="grid-2" style="gap:6px;">
            <button type="button" id="btnDuelResume" class="btn-primary">متابعة اللعب</button>
            <button type="button" id="btnDuelReset">🔄 جلسة جديدة</button>
          </div>
        </div>
      `;
      body.querySelector('#btnDuelResume')?.addEventListener('click', () => {
        duelShowReport = false;
        renderDuelView();
      });
      body.querySelector('#btnDuelReset')?.addEventListener('click', () => {
        duelState = createGtoDuelState();
        duelLastRecord = null;
        duelShowReport = false;
        renderDuelView();
      });
      return;
    }

    body.innerHTML = `
      <div class="row between" style="margin-bottom:6px;font-size:0.76rem;flex-wrap:wrap;gap:6px;">
        <span style="color:#facc15;font-weight:800;">الجولة ${duelState.history.length + 1} • النقاط: ${duelState.score}</span>
        <span class="badge" style="font-size:0.7rem;">
          التوقّع: ${pred.sufficientSample ? `${pred.predictabilityPct}%` : `عينة أولية (${pred.sampleSize}/5)`}
        </span>
      </div>

      ${renderDuelArenaSvg()}

      <div class="item-box" style="margin-bottom:8px;border-color:rgba(250,204,21,0.3);font-size:0.77rem;">
        <div style="color:#fde047;font-weight:800;margin-bottom:2px;">👀 قراءة وقفة المدافع:</div>
        <div style="color:#e4e4e7;">${escapeHtml(duelState.stance.cueAr)}</div>
        ${
          duelLastRecord
            ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);color:${
                duelLastRecord.outcome === 'win'
                  ? '#4ade80'
                  : duelLastRecord.outcome === 'partial'
                    ? '#fbbf24'
                    : '#fb7185'
              };font-weight:700;">${escapeHtml(duelLastRecord.reasonAr)}</div>`
            : ''
        }
      </div>

      <div class="grid-2" style="gap:7px;margin-bottom:8px;">
        ${GTO_DUEL_ACTIONS.map(
          (a) => `<button type="button" data-duel-action="${a.id}" class="btn-amber" style="min-height:46px;font-size:0.79rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
            <strong>${escapeHtml(a.labelAr)}</strong>
            <span style="font-size:0.66rem;opacity:0.85;">${escapeHtml(a.riskTagAr)}</span>
          </button>`
        ).join('')}
      </div>

      <div class="row between" style="gap:6px;flex-wrap:wrap;">
        <span class="muted" style="font-size:0.71rem;">${escapeHtml(pred.labelAr)}</span>
        <button type="button" id="btnDuelOpenReport" class="icon-btn" style="min-height:32px;font-size:0.74rem;" ${duelState.history.length === 0 ? 'disabled' : ''}>📊 تقرير التنويع</button>
      </div>
    `;

    body.querySelectorAll<HTMLButtonElement>('[data-duel-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.duelAction as GtoDuelAction;
        const { nextState, record } = stepGtoDuel(duelState, action);
        duelState = nextState;
        duelLastRecord = record;
        renderDuelView();
      });
    });

    body.querySelector('#btnDuelOpenReport')?.addEventListener('click', () => {
      if (duelState.history.length >= 3) {
        const rep = summarizeGtoDuelSession(duelState);
        saveGtoHistory({
          ts: Date.now(),
          rounds: rep.totalRounds,
          winRatePct: rep.winRatePct,
          predictabilityPct: rep.predictability.predictabilityPct,
        });
        toast?.('تم حفظ ملخص الجلسة محلياً على جهازك ✓');
      }
      duelShowReport = true;
      renderDuelView();
    });
  };

  const renderGhostView = () => {
    const summary = opts.getGhostSummary?.() || null;
    body.innerHTML = `
      <div class="item-box" style="margin-bottom:10px;border-color:rgba(250,204,21,0.38);">
        <div class="row between" style="gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <strong style="color:#fde047;font-size:0.9rem;">👻 محرك خطط الشبح والتحدّي (Ghost Play)</strong>
          <span class="badge">${summary ? `${summary.framesCount} لقطات • ${summary.durationSec.toFixed(1)} ث` : 'جاهز من الملعب الحالي'}</span>
        </div>
        <p style="margin:0 0 8px;font-size:0.78rem;color:#d4d4d8;line-height:1.55;">
          حوّل الخطة الحالية أو اللقطات المسجّلة إلى عرض تفاعلي قابل للمشاركة برابط فوري (<strong>#ghost=v1</strong>) يفتح لدى أي لاعب <strong>بدون تسجيل دخول</strong> وبدون قاعدة بيانات، مع تحدّي إيقاف الخطة وتصدير فيديو محلي.
        </p>
        ${
          summary
            ? `<div style="padding:7px 10px;border-radius:10px;background:rgba(250,204,21,0.08);border:1px solid rgba(250,204,21,0.22);font-size:0.77rem;color:#fef08a;">
                الخطة الجاهزة الآن: <strong>${escapeHtml(summary.title)}</strong>
              </div>`
            : `<div style="padding:7px 10px;border-radius:10px;background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.24);font-size:0.76rem;color:#fda4af;">
                اختر أي خطة في الملعب أو سجّل لقطتين من خيارات الخطة للبدء.
              </div>`
        }
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
        <button type="button" id="btnLabLaunchGhostTheater" class="btn-primary" style="width:100%;min-height:46px;font-size:0.86rem;">
          🎬 فتح مسرح الشبح + تحدّي إيقاف الخطة (Challenge Mode)
        </button>
        <div class="grid-2" style="gap:8px;">
          <button type="button" id="btnLabCopyGhostLink" class="btn-amber" style="min-height:42px;font-size:0.79rem;">
            🔗 نسخ رابط الشبح (بدون دخول)
          </button>
          <button type="button" id="btnLabExportGhostWebm" class="icon-btn" style="min-height:42px;justify-content:center;font-size:0.79rem;">
            📹 تصدير فيديو محلي (WebM)
          </button>
        </div>
      </div>

      <div class="item-box" style="margin:0;font-size:0.74rem;color:#a1a1aa;line-height:1.55;">
        <strong style="color:#e4e4e7;">ماذا يمكنك فعله داخل مسرح الشبح؟</strong><br/>
        • اسحب مدافعاً أزرق لاعتراض مسار الكرة وشاهد مؤشر <strong>زمن الاعتراض</strong> المباشر.<br/>
        • فعّل <strong>أشعة X</strong> فوق حركة الشبح لكشف المساحات المفتوحة وظلال التغطية.<br/>
        • شارك الرابط في واتساب ليعرضه الفريق فوراً بدون إنشاء حساب.
      </div>
    `;

    body.querySelector('#btnLabLaunchGhostTheater')?.addEventListener('click', () => {
      if (opts.onOpenGhostTheater) {
        closeModal();
        opts.onOpenGhostTheater();
      } else {
        toast?.('افتح مسرح الشبح من داخل استوديو التكتيك', true);
      }
    });
    body.querySelector('#btnLabCopyGhostLink')?.addEventListener('click', () => {
      opts.onCopyGhostLink?.();
    });
    body.querySelector('#btnLabExportGhostWebm')?.addEventListener('click', () => {
      opts.onExportGhostWebm?.();
    });
  };

  const renderPitWallView = () => {
    if (!opts.pitWallController) {
      body.innerHTML = `<div class="item-box" style="font-size:0.8rem;color:#d4d4d8;">غرفة الدكة متاحة من أدوات الكابتن داخل استوديو التكتيك.</div>`;
      return;
    }
    body.innerHTML = `<div id="tacLabPitWallHost"></div>`;
    const host = body.querySelector('#tacLabPitWallHost') as HTMLElement | null;
    if (host) {
      opts.pitWallController.render(host);
    }
  };

  const renderActiveTab = () => {
    modal.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((b) => {
      const isAct = b.dataset.labTab === activeTab;
      b.classList.toggle('active', isAct);
      b.setAttribute('aria-selected', String(isAct));
    });
    if (activeTab === 'radar') renderRadarView();
    else if (activeTab === 'ghost') renderGhostView();
    else if (activeTab === 'pitwall') renderPitWallView();
    else renderDuelView();
  };

  modal.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearRadarTimers();
      activeTab = (btn.dataset.labTab as TacticalLabTab) || 'radar';
      renderActiveTab();
    });
  });

  const btnModalXray = modal.querySelector('#btnLabModalXray') as HTMLButtonElement | null;
  btnModalXray?.addEventListener('click', () => {
    opts.onToggleXray?.();
    const nowOn = Boolean(opts.isXrayEnabled?.());
    btnModalXray.classList.toggle('active', nowOn);
    btnModalXray.setAttribute('aria-pressed', String(nowOn));
    btnModalXray.textContent = `🔬 أشعة X: ${nowOn ? 'مفعّلة' : 'تشغيل'}`;
  });

  const closeModal = () => {
    clearRadarTimers();
    modal.remove();
  };

  modal.querySelector('#btnCloseTacticalLab')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  renderActiveTab();
}
