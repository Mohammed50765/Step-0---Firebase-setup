/**
 * MAYDAN BLACK BOX — UNIFIED TACTICAL ANALYSIS ROOM UI
 * Flow: Role Selection & DNA -> Error / Freeze / Real Rewind / Correct Cinema + Narrator -> Interactive Player Challenge -> Completion
 *
 * Pure vanilla TypeScript + DOM + SVG (`360x520` portrait space reusing `src/tacticsEngine.ts`).
 * Zero new Firebase reads/writes, zero paid APIs, full mobile touch & RTL support, clean resource disposal.
 */

import { escapeHtml } from '../security';
import { buildCurvedArrowGeometry, projectClientToPitchPct } from '../tacticsEngine';
import type { Point2D } from '../tacticsLayout';
import {
  ROLE_DNA_CATALOG,
  getRoleDnaById,
  resolveRoleWithFormationSlot,
  evaluateRolePairings,
  type BlackBoxRoleId,
} from '../engine/roleDna';
import {
  BLACK_BOX_SCENARIOS,
  getBlackBoxScenarioById,
  getCinemaTimelineBounds,
  sampleBlackBoxTimeline,
  evaluateBlackBoxChallenge,
  type BlackBoxScenarioDef,
  type CinemaPhaseId,
  type CinemaTimelineSample,
  type ChallengeValidationResult,
} from '../engine/blackBoxCinema';
import { TacticalNeuralNarrator, type NarratorAudioState } from '../engine/tacticalNarrator';

export interface BlackBoxOpenOptions {
  initialScenarioId?: BlackBoxScenarioDef['id'];
  initialRoleId?: BlackBoxRoleId;
  toast?: (msg: string, isErr?: boolean) => void;
}

type BlackBoxStep = 'dna' | 'cinema' | 'challenge';
type DnaSubTab = 'duties' | 'decisions' | 'synergy';

const SVG_W = 360;
const SVG_H = 520;
const SLOT_CODES_221 = ['GK', 'ANC', 'LIB', 'LM', 'INV', 'F9'];

const PHASE_LABELS: Record<Exclude<CinemaPhaseId, 'challenge'>, string> = {
  setup: 'البداية',
  error: 'الخطأ',
  freeze: 'تجميد',
  rewind: 'إرجاع ◀◀',
  correct: 'التصحيح',
};

function px(xPct: number): number {
  return Number(((xPct / 100) * SVG_W).toFixed(1));
}

function py(yPct: number): number {
  return Number(((yPct / 100) * SVG_H).toFixed(1));
}

function buildObsidianPitchBaseSvg(uid: string): string {
  return `
    <defs>
      <linearGradient id="${uid}_turf" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0B1410" />
        <stop offset="50%" stop-color="#0E1A15" />
        <stop offset="100%" stop-color="#0A120E" />
      </linearGradient>
      <radialGradient id="${uid}_vignette" cx="50%" cy="48%" r="65%">
        <stop offset="0%" stop-color="rgba(212,175,55,0.06)" />
        <stop offset="100%" stop-color="rgba(9,10,12,0.55)" />
      </radialGradient>
      <marker id="${uid}_arr_gold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#F3D578" />
      </marker>
      <marker id="${uid}_arr_red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#FB7185" />
      </marker>
      <marker id="${uid}_arr_neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#CBD5E1" />
      </marker>
    </defs>
    <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="12" fill="url(#${uid}_turf)" />
    <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="12" fill="url(#${uid}_vignette)" />
    <g stroke="rgba(243,244,246,0.16)" stroke-width="1.2" fill="none">
      <rect x="16" y="18" width="${SVG_W - 32}" height="${SVG_H - 36}" rx="4" />
      <line x1="16" y1="${SVG_H / 2}" x2="${SVG_W - 16}" y2="${SVG_H / 2}" />
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="42" />
      <circle cx="${SVG_W / 2}" cy="${SVG_H / 2}" r="2.2" fill="rgba(243,244,246,0.35)" />
      <rect x="96" y="18" width="168" height="68" />
      <rect x="134" y="18" width="92" height="24" />
      <rect x="96" y="${SVG_H - 86}" width="168" height="68" />
      <rect x="134" y="${SVG_H - 42}" width="92" height="24" />
    </g>
    <text x="${SVG_W / 2}" y="13" text-anchor="middle" fill="rgba(148,163,184,0.68)" font-size="9" font-weight="700">مرمى الخصم</text>
    <text x="${SVG_W / 2}" y="${SVG_H - 5}" text-anchor="middle" fill="rgba(212,175,55,0.72)" font-size="9" font-weight="700">مرمانا</text>
  `;
}

export function openBlackBoxModal(opts: BlackBoxOpenOptions = {}): void {
  document.getElementById('maydanBlackBoxModal')?.remove();

  const uid = `bbox_${Date.now().toString(36)}`;
  let step: BlackBoxStep = 'dna';
  let selectedRoleId: BlackBoxRoleId = opts.initialRoleId || 'buildup_libero';
  let dnaSubTab: DnaSubTab = 'duties';
  let activeSynergyRoles: Set<BlackBoxRoleId> = new Set([
    'anchor',
    'buildup_libero',
    'inverted_winger',
    'false_9',
  ]);
  let scenario: BlackBoxScenarioDef = getBlackBoxScenarioById(
    opts.initialScenarioId || 'buildup_under_pressure'
  );

  // Cinema timeline playback state
  let timelineElapsedMs = 0;
  let isPlaying = false;
  let lastRafTs = 0;
  let rafId = 0;
  let lastSpokenPhase: Exclude<CinemaPhaseId, 'challenge'> | null = null;
  let lastSample: CinemaTimelineSample = sampleBlackBoxTimeline(scenario, 0);

  // Challenge state
  let challengePlayerPos: Point2D = {
    ...scenario.challenge.initialFrame.ourPos[scenario.challenge.playerIndex],
  };
  let challengeResult: ChallengeValidationResult | null = null;
  let isDraggingChallengePlayer = false;
  let dragPointerId: number | null = null;
  const completedScenarioIds = new Set<string>();

  // Narrator instance (auto-disposed on modal close)
  const narrator = new TacticalNeuralNarrator((audioState) => {
    syncAudioStrip(audioState);
  });

  const modal = document.createElement('div');
  modal.id = 'maydanBlackBoxModal';
  modal.className = 'bbox-overlay';
  modal.setAttribute('dir', 'rtl');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'الصندوق الأسود التكتيكي — Maydan Black Box');

  modal.innerHTML = `
    <div class="bbox-shell">
      <header class="bbox-header">
        <div class="bbox-title-block">
          <div class="bbox-kicker" dir="ltr">MAYDAN BLACK BOX • 2-2-1</div>
          <h2 class="bbox-title">الصندوق الأسود التكتيكي</h2>
        </div>
        <div class="bbox-header-right">
          <span id="bboxProgressBadge" class="bbox-progress-badge">الإنجاز: 0 / 2</span>
          <button type="button" id="bboxCloseBtn" class="bbox-close-btn" aria-label="إغلاق الصندوق الأسود">✕</button>
        </div>
      </header>

      <nav class="bbox-stepper" role="tablist" aria-label="مراحل التجربة التكتيكية">
        <button type="button" class="bbox-step-btn active" data-bbox-step="dna" role="tab" aria-selected="true">
          <span class="bbox-step-num" dir="ltr">01</span>
          <span>الدور و DNA</span>
        </button>
        <button type="button" class="bbox-step-btn" data-bbox-step="cinema" role="tab" aria-selected="false">
          <span class="bbox-step-num" dir="ltr">02</span>
          <span>سينما الإرجاع</span>
        </button>
        <button type="button" class="bbox-step-btn" data-bbox-step="challenge" role="tab" aria-selected="false">
          <span class="bbox-step-num" dir="ltr">03</span>
          <span>تحدّي القرار</span>
        </button>
      </nav>

      <div id="bboxBody" class="bbox-body"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const bodyEl = modal.querySelector('#bboxBody') as HTMLElement;
  const progressBadgeEl = modal.querySelector('#bboxProgressBadge') as HTMLElement;

  function stopPlaybackLoop(): void {
    isPlaying = false;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastRafTs = 0;
  }

  function closeModal(): void {
    stopPlaybackLoop();
    narrator.dispose();
    document.removeEventListener('keydown', onKeyDown);
    modal.remove();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeModal();
    }
  }
  document.addEventListener('keydown', onKeyDown);
  modal.querySelector('#bboxCloseBtn')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  function updateHeaderProgress(): void {
    const done = completedScenarioIds.size;
    progressBadgeEl.textContent =
      done >= BLACK_BOX_SCENARIOS.length
        ? `مكتمل ${done} / ${BLACK_BOX_SCENARIOS.length}`
        : `الإنجاز: ${done} / ${BLACK_BOX_SCENARIOS.length}`;
    progressBadgeEl.classList.toggle('is-complete', done >= BLACK_BOX_SCENARIOS.length);
  }

  function updateStepperActive(): void {
    modal.querySelectorAll<HTMLButtonElement>('[data-bbox-step]').forEach((btn) => {
      const active = btn.dataset.bboxStep === step;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  modal.querySelectorAll<HTMLButtonElement>('[data-bbox-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.bboxStep as BlackBoxStep;
      if (!next || next === step) return;
      narrator.unlockFromUserGesture();
      if (next !== 'cinema') {
        stopPlaybackLoop();
        narrator.cancelSpeech();
      }
      step = next;
      if (step === 'challenge') {
        resetChallengeForScenario(false);
      }
      renderCurrentStep();
    });
  });

  function resetChallengeForScenario(keepCompleted = true): void {
    challengePlayerPos = {
      ...scenario.challenge.initialFrame.ourPos[scenario.challenge.playerIndex],
    };
    challengeResult = null;
    isDraggingChallengePlayer = false;
    dragPointerId = null;
    if (!keepCompleted) {
      updateHeaderProgress();
    }
  }

  function selectScenario(id: BlackBoxScenarioDef['id'], autoPlay = false): void {
    stopPlaybackLoop();
    narrator.cancelSpeech();
    scenario = getBlackBoxScenarioById(id);
    timelineElapsedMs = 0;
    lastSpokenPhase = null;
    lastSample = sampleBlackBoxTimeline(scenario, 0);
    resetChallengeForScenario(true);
    if (step === 'cinema') {
      bodyEl.scrollTop = 0;
      renderCinemaStep();
      if (autoPlay) {
        startCinemaPlayback();
      }
    } else if (step === 'challenge') {
      bodyEl.scrollTop = 0;
      renderChallengeStep();
    }
  }

  // =========================================================================
  // STEP 1 — ROLE SELECTION & ROLE DNA + SYNERGY / WARNINGS
  // =========================================================================
  function buildDnaSvg(roleId: BlackBoxRoleId): string {
    const role = getRoleDnaById(roleId);
    const otherRoles = ROLE_DNA_CATALOG.filter((r) => r.id !== roleId);

    const partnerLines = role.partnerRelationships
      .map((rel) => {
        const partner = getRoleDnaById(rel.partnerId);
        return `<line x1="${px(role.homePosition.x)}" y1="${py(role.homePosition.y)}" x2="${px(partner.homePosition.x)}" y2="${py(partner.homePosition.y)}" stroke="rgba(212,175,55,0.45)" stroke-width="1.5" stroke-dasharray="5 5" />`;
      })
      .join('');

    const preferredEls = role.preferredZones
      .map(
        (z) => `
        <ellipse cx="${px(z.x)}" cy="${py(z.y)}" rx="${px(z.rx)}" ry="${py(z.ry)}"
          fill="rgba(212,175,55,0.18)" stroke="#D4AF37" stroke-width="1.8" />
        <text x="${px(z.x)}" y="${py(z.y) - py(z.ry) - 5}" text-anchor="middle" fill="#F3D578" font-size="9.5" font-weight="800" paint-order="stroke" stroke="#080E0B" stroke-width="3.5" stroke-linejoin="round">${escapeHtml(z.label)}</text>`
      )
      .join('');

    const conditionalEls = role.conditionalZones
      .map(
        (z) => `
        <ellipse cx="${px(z.x)}" cy="${py(z.y)}" rx="${px(z.rx)}" ry="${py(z.ry)}"
          fill="rgba(226,232,240,0.08)" stroke="rgba(226,232,240,0.58)" stroke-width="1.4" stroke-dasharray="4 4" />
        <text x="${px(z.x)}" y="${py(z.y) + 3}" text-anchor="middle" fill="#E2E8F0" font-size="8.6" font-weight="700" paint-order="stroke" stroke="#080E0B" stroke-width="3.2" stroke-linejoin="round">${escapeHtml(z.label)}</text>`
      )
      .join('');

    const highRiskEls = role.highRiskZones
      .map(
        (z) => `
        <ellipse cx="${px(z.x)}" cy="${py(z.y)}" rx="${px(z.rx)}" ry="${py(z.ry)}"
          fill="rgba(244,63,94,0.14)" stroke="#FB7185" stroke-width="1.5" stroke-dasharray="4 3" />
        <text x="${px(z.x)}" y="${py(z.y) + 3}" text-anchor="middle" fill="#FDA4AF" font-size="8.6" font-weight="700" paint-order="stroke" stroke="#080E0B" stroke-width="3.2" stroke-linejoin="round">${escapeHtml(z.label)}</text>`
      )
      .join('');

    const peerDots = otherRoles
      .map(
        (r) => `
        <g opacity="0.72">
          <circle cx="${px(r.homePosition.x)}" cy="${py(r.homePosition.y)}" r="12" fill="#181C24" stroke="rgba(226,232,240,0.45)" stroke-width="1.4" />
          <text x="${px(r.homePosition.x)}" y="${py(r.homePosition.y) + 3.5}" text-anchor="middle" fill="#CBD5E1" font-size="8.5" font-weight="800" dir="ltr">${escapeHtml(r.code)}</text>
        </g>`
      )
      .join('');

    const gkDot = `
      <g opacity="0.65">
        <circle cx="${px(50)}" cy="${py(90)}" r="11" fill="#181C24" stroke="rgba(212,175,55,0.45)" stroke-width="1.2" />
        <text x="${px(50)}" y="${py(90) + 3.2}" text-anchor="middle" fill="#D4AF37" font-size="8" font-weight="800" dir="ltr">GK</text>
      </g>
    `;

    const activeDot = `
      <g>
        <circle cx="${px(role.homePosition.x)}" cy="${py(role.homePosition.y)}" r="20" fill="rgba(212,175,55,0.16)" stroke="rgba(243,213,120,0.75)" stroke-width="1.4" />
        <circle cx="${px(role.homePosition.x)}" cy="${py(role.homePosition.y)}" r="14" fill="#D4AF37" stroke="#090A0C" stroke-width="2" />
        <text x="${px(role.homePosition.x)}" y="${py(role.homePosition.y) + 3.8}" text-anchor="middle" fill="#090A0C" font-size="9" font-weight="900" dir="ltr">${escapeHtml(role.code)}</text>
      </g>
    `;

    return `
      <svg class="bbox-pitch-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="خريطة مناطق الدور ${escapeHtml(role.titleAr)}">
        ${buildObsidianPitchBaseSvg(`${uid}_dna`)}
        ${highRiskEls}
        ${conditionalEls}
        ${preferredEls}
        ${partnerLines}
        ${gkDot}
        ${peerDots}
        ${activeDot}
      </svg>
    `;
  }

  function renderDnaSubContent(): string {
    const role = getRoleDnaById(selectedRoleId);
    const resolved = resolveRoleWithFormationSlot(selectedRoleId);

    if (dnaSubTab === 'duties') {
      return `
        <div class="bbox-dna-section">
          <div class="bbox-callout-gold">
            <span class="bbox-tag-label">القاعدة الذهبية في 2-2-1</span>
            <p>${escapeHtml(resolved.legacySpotlightRule)}</p>
          </div>
          <div class="bbox-grid-2">
            <div class="bbox-info-box">
              <h4>بالكرة (On-Ball)</h4>
              <ul>${role.onBallResponsibilities.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
            </div>
            <div class="bbox-info-box">
              <h4>بدون كرة (Off-Ball)</h4>
              <ul>${role.offBallResponsibilities.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
            </div>
          </div>
          <div class="bbox-info-box">
            <h4>محفّزات الضغط والتحوّل</h4>
            <ul>${role.pressingTriggers.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
            <div class="bbox-trans-grid">
              <div><strong>عند فقدان الكرة:</strong> ${escapeHtml(role.transitionBehavior.attackToDefense)}</div>
              <div><strong>عند افتكاك الكرة:</strong> ${escapeHtml(role.transitionBehavior.defenseToAttack)}</div>
            </div>
          </div>
        </div>
      `;
    }

    if (dnaSubTab === 'decisions') {
      return `
        <div class="bbox-dna-section">
          <div class="bbox-info-box">
            <h4>علاقات الشركاء داخل 2-2-1</h4>
            <div class="bbox-partner-list">
              ${role.partnerRelationships
                .map((rel) => {
                  const partner = getRoleDnaById(rel.partnerId);
                  return `
                    <div class="bbox-partner-item">
                      <strong>${escapeHtml(rel.relationTitle)} — ${escapeHtml(partner.titleAr)}</strong>
                      <p>${escapeHtml(rel.coordinationRule)}</p>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
          ${role.correctDecisions
            .map(
              (dec) => `
              <div class="bbox-decision-card">
                <div class="bbox-dec-sit">${escapeHtml(dec.situation)}</div>
                <div class="bbox-dec-bad"><strong>الخطأ الشائع:</strong> ${escapeHtml(dec.mistake)}</div>
                <div class="bbox-dec-good"><strong>القرار الصحيح:</strong> ${escapeHtml(dec.correctDecision)}</div>
                <div class="bbox-dec-why"><strong>لماذا ينجح:</strong> ${escapeHtml(dec.whyItWorks)}</div>
              </div>
            `
            )
            .join('')}
          <div class="bbox-info-box">
            <h4>أخطاء يجب تجنّبها</h4>
            <ul>${role.commonMistakes.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>
          </div>
        </div>
      `;
    }

    // dnaSubTab === 'synergy'
    const report = evaluateRolePairings(Array.from(activeSynergyRoles));
    return `
      <div class="bbox-dna-section">
        <div class="bbox-info-box">
          <h4>اختبر تركيبة الأدوار (قواعد كروية شفافة)</h4>
          <p class="bbox-muted-copy">فعّل أو عطّل أي دور لمشاهدة التناغم الحقيقي أو التحذير التكتيكي المباشر دون أي نسب عشوائية.</p>
          <div class="bbox-synergy-toggles">
            ${ROLE_DNA_CATALOG.map((r) => {
              const checked = activeSynergyRoles.has(r.id);
              return `
                <button type="button" class="bbox-syn-toggle ${checked ? 'is-on' : ''}" data-syn-role="${r.id}" aria-pressed="${checked}">
                  <span class="bbox-code" dir="ltr">${escapeHtml(r.code)}</span>
                  <span>${escapeHtml(r.titleAr)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div class="bbox-rule-group">
          <h4 class="bbox-rule-head-gold">نقاط التناغم (${report.synergies.length})</h4>
          ${
            report.synergies.length === 0
              ? '<p class="bbox-muted-copy">فعّل دورين مترابطين على الأقل لإظهار علاقات التناغم التكتيكي.</p>'
              : report.synergies
                  .map(
                    (s) => `
                  <div class="bbox-rule-card is-synergy">
                    <strong>${escapeHtml(s.title)}</strong>
                    <p>${escapeHtml(s.explanation)}</p>
                    <div class="bbox-rule-adj">توجيه عملي: ${escapeHtml(s.tacticalAdjustment)}</div>
                  </div>
                `
                  )
                  .join('')
          }
        </div>

        <div class="bbox-rule-group">
          <h4 class="bbox-rule-head-red">تحذيرات تكتيكية (${report.warnings.length})</h4>
          ${
            report.warnings.length === 0
              ? '<p class="bbox-muted-copy">لا توجد فجوات بنيوية واضحة في هذه التركيبة المتوازنة.</p>'
              : report.warnings
                  .map(
                    (w) => `
                  <div class="bbox-rule-card is-warning">
                    <strong>${escapeHtml(w.title)}</strong>
                    <p>${escapeHtml(w.explanation)}</p>
                    <div class="bbox-rule-adj">التعديل المقترح: ${escapeHtml(w.tacticalAdjustment)}</div>
                  </div>
                `
                  )
                  .join('')
          }
        </div>
      </div>
    `;
  }

  function renderDnaStep(): void {
    const role = getRoleDnaById(selectedRoleId);
    bodyEl.innerHTML = `
      <div class="bbox-split">
        <div class="bbox-stage-col">
          <div class="bbox-role-selector" role="group" aria-label="اختيار الدور التكتيكي">
            ${ROLE_DNA_CATALOG.map(
              (r) => `
              <button type="button" class="bbox-role-btn ${r.id === selectedRoleId ? 'active' : ''}" data-role-pick="${r.id}">
                <span class="bbox-code" dir="ltr">${escapeHtml(r.code)}</span>
                <strong>${escapeHtml(r.titleAr)}</strong>
              </button>
            `
            ).join('')}
          </div>

          <div class="bbox-pitch-frame">
            ${buildDnaSvg(selectedRoleId)}
          </div>

          <div class="bbox-legend-bar">
            <span><i class="bbox-dot-gold"></i> منطقة مفضلة</span>
            <span><i class="bbox-dot-cond"></i> إرشاد مشروط</span>
            <span><i class="bbox-dot-red"></i> مخاطرة عالية</span>
          </div>
        </div>

        <div class="bbox-panel-col">
          <div class="bbox-role-hero">
            <div class="bbox-role-hero-top">
              <span class="bbox-code-lg" dir="ltr">${escapeHtml(role.code)}</span>
              <div>
                <h3>${escapeHtml(role.titleAr)}</h3>
                <div class="bbox-role-en" dir="ltr">${escapeHtml(role.titleEn)} • 2-2-1</div>
              </div>
            </div>
            <p class="bbox-role-identity">${escapeHtml(role.identityLine)}</p>
          </div>

          <div class="bbox-subtabs" role="tablist">
            <button type="button" class="bbox-subtab ${dnaSubTab === 'duties' ? 'active' : ''}" data-dna-tab="duties">الواجبات والضغط</button>
            <button type="button" class="bbox-subtab ${dnaSubTab === 'decisions' ? 'active' : ''}" data-dna-tab="decisions">القرارات والشركاء</button>
            <button type="button" class="bbox-subtab ${dnaSubTab === 'synergy' ? 'active' : ''}" data-dna-tab="synergy">التكامل والتحذيرات</button>
          </div>

          <div id="bboxDnaSubBody">${renderDnaSubContent()}</div>

          <div class="bbox-cta-bar">
            <button type="button" id="bboxStartCinemaBtn" class="bbox-btn-gold">
              ابدأ سينما الخطأ والإرجاع ←
            </button>
          </div>
        </div>
      </div>
    `;

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-role-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        narrator.unlockFromUserGesture();
        narrator.playSoftFeedback('select');
        selectedRoleId = btn.dataset.rolePick as BlackBoxRoleId;
        // Align default scenario with chosen role for a unified narrative
        if (selectedRoleId === 'anchor') {
          scenario = getBlackBoxScenarioById('defensive_cover_space');
        } else if (selectedRoleId === 'buildup_libero' || selectedRoleId === 'inverted_winger') {
          scenario = getBlackBoxScenarioById('buildup_under_pressure');
        }
        renderDnaStep();
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-dna-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dnaSubTab = btn.dataset.dnaTab as DnaSubTab;
        renderDnaStep();
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-syn-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = btn.dataset.synRole as BlackBoxRoleId;
        if (activeSynergyRoles.has(rid)) {
          if (activeSynergyRoles.size > 1) activeSynergyRoles.delete(rid);
        } else {
          activeSynergyRoles.add(rid);
        }
        renderDnaStep();
      });
    });

    bodyEl.querySelector('#bboxStartCinemaBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      step = 'cinema';
      timelineElapsedMs = 0;
      lastSpokenPhase = null;
      renderCurrentStep();
      startCinemaPlayback();
    });
  }

  // =========================================================================
  // STEP 2 — ERROR → FREEZE → REAL REWIND → CORRECT CINEMA + NARRATOR
  // =========================================================================
  function buildCinemaPitchSvgContent(sample: CinemaTimelineSample): string {
    const svgUid = `${uid}_cin`;

    const trianglesHtml = sample.triangles
      .map((tri) => {
        const p0 = sample.ourPos[tri[0]];
        const p1 = sample.ourPos[tri[1]];
        const p2 = sample.ourPos[tri[2]];
        if (!p0 || !p1 || !p2) return '';
        return `<polygon points="${px(p0.x)},${py(p0.y)} ${px(p1.x)},${py(p1.y)} ${px(p2.x)},${py(p2.y)}" fill="rgba(212,175,55,0.13)" stroke="rgba(243,213,120,0.45)" stroke-width="1.2" stroke-dasharray="4 3" />`;
      })
      .join('');

    const zonesHtml = sample.zones
      .map((z) => {
        const isDanger = z.color === 'rose' || sample.emphasis === 'mistake';
        const fill = isDanger ? 'rgba(244,63,94,0.22)' : 'rgba(212,175,55,0.18)';
        const stroke = isDanger ? '#FB7185' : '#F3D578';
        return `
          <g>
            <circle cx="${px(z.x)}" cy="${py(z.y)}" r="${px(z.r)}" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-dasharray="${isDanger ? '5 4' : 'none'}" />
            ${
              z.label
                ? `<text x="${px(z.x)}" y="${py(z.y) - px(z.r) - 6}" text-anchor="middle" fill="${stroke}" font-size="9.5" font-weight="800" paint-order="stroke" stroke="#080E0B" stroke-width="3.5" stroke-linejoin="round">${escapeHtml(z.label)}</text>`
                : ''
            }
          </g>
        `;
      })
      .join('');

    const arrowsHtml = sample.arrows
      .map((arr) => {
        const geom = buildCurvedArrowGeometry(
          px(arr.from[0]),
          py(arr.from[1]),
          px(arr.to[0]),
          py(arr.to[1]),
          arr.kind
        );
        const isMistake = sample.emphasis === 'mistake';
        const stroke = isMistake ? '#FB7185' : '#F3D578';
        const marker = isMistake ? `url(#${svgUid}_arr_red)` : `url(#${svgUid}_arr_gold)`;
        const dash = arr.kind === 'run' || arr.kind === 'cover' ? 'stroke-dasharray="6 4"' : '';
        return `
          <g>
            <path d="${geom.pathD}" fill="none" stroke="${stroke}" stroke-width="2.4" ${dash} marker-end="${marker}" opacity="0.92" />
          </g>
        `;
      })
      .join('');

    const oppHtml = sample.oppPos
      .map((pt, i) => {
        const cx = px(pt.x);
        const cy = py(pt.y);
        return `
          <g data-opp-idx="${i}">
            <circle cx="${cx}" cy="${cy}" r="11.5" fill="#1F1218" stroke="#FB7185" stroke-width="1.6" />
            <text x="${cx}" y="${cy + 3.4}" text-anchor="middle" fill="#FECDD3" font-size="8.5" font-weight="800" dir="ltr">X${i + 1}</text>
          </g>
        `;
      })
      .join('');

    const ourHtml = sample.ourPos
      .map((pt, i) => {
        const cx = px(pt.x);
        const cy = py(pt.y);
        const isActive = sample.activeIndices.includes(i);
        const isChallengeActor = i === scenario.challenge.playerIndex;
        const ringColor =
          sample.emphasis === 'mistake' && isActive
            ? '#FB7185'
            : sample.emphasis === 'correct' && isActive
              ? '#F3D578'
              : sample.isRewinding && isChallengeActor
                ? '#F3D578'
                : 'rgba(226,232,240,0.45)';
        const fill =
          isActive && sample.emphasis === 'correct'
            ? '#D4AF37'
            : isActive && sample.emphasis === 'mistake'
              ? '#3F1420'
              : '#151922';
        const txtColor = isActive && sample.emphasis === 'correct' ? '#090A0C' : '#F3F4F6';
        return `
          <g data-our-idx="${i}" data-x="${pt.x.toFixed(1)}" data-y="${pt.y.toFixed(1)}">
            ${
              isActive
                ? `<circle cx="${cx}" cy="${cy}" r="18.5" fill="none" stroke="${ringColor}" stroke-width="1.6" stroke-dasharray="${sample.isRewinding ? '3 3' : 'none'}" opacity="0.88" />`
                : ''
            }
            <circle cx="${cx}" cy="${cy}" r="12.5" fill="${fill}" stroke="${ringColor}" stroke-width="2" />
            <text x="${cx}" y="${cy + 3.4}" text-anchor="middle" fill="${txtColor}" font-size="8.2" font-weight="900" dir="ltr">${SLOT_CODES_221[i] || `P${i + 1}`}</text>
          </g>
        `;
      })
      .join('');

    const bx = px(sample.ball.x);
    const by = py(sample.ball.y);
    const br = Number((6.2 * sample.ball.scale).toFixed(1));
    const ballHtml = `
      <g data-ball-x="${sample.ball.x.toFixed(1)}" data-ball-y="${sample.ball.y.toFixed(1)}">
        <ellipse cx="${bx}" cy="${by + sample.ball.shadowDy + 4}" rx="${br}" ry="3" fill="rgba(0,0,0,0.45)" />
        <circle cx="${bx}" cy="${by}" r="${br}" fill="#F8FAFC" stroke="#090A0C" stroke-width="1.5" />
      </g>
    `;

    return `
      ${buildObsidianPitchBaseSvg(svgUid)}
      ${trianglesHtml}
      ${zonesHtml}
      ${arrowsHtml}
      ${oppHtml}
      ${ourHtml}
      ${ballHtml}
    `;
  }

  function syncAudioStrip(audioState: NarratorAudioState): void {
    const muteBtn = bodyEl.querySelector('#bboxAudioMuteBtn') as HTMLButtonElement | null;
    const speechBtn = bodyEl.querySelector('#bboxAudioSpeechBtn') as HTMLButtonElement | null;
    const musicBtn = bodyEl.querySelector('#bboxAudioMusicBtn') as HTMLButtonElement | null;
    const volRange = bodyEl.querySelector('#bboxAudioVolRange') as HTMLInputElement | null;
    const statusEl = bodyEl.querySelector('#bboxAudioStatus') as HTMLElement | null;
    if (!muteBtn) return;

    muteBtn.textContent = audioState.muted ? '🔇 صامت' : '🔊 الصوت';
    muteBtn.setAttribute('aria-pressed', audioState.muted ? 'true' : 'false');
    muteBtn.classList.toggle('is-muted', audioState.muted);

    if (speechBtn) {
      speechBtn.classList.toggle('active', audioState.speechEnabled && !audioState.muted);
      speechBtn.setAttribute('aria-pressed', audioState.speechEnabled ? 'true' : 'false');
    }
    if (musicBtn) {
      musicBtn.classList.toggle('active', audioState.musicEnabled && !audioState.muted);
      musicBtn.setAttribute('aria-pressed', audioState.musicEnabled ? 'true' : 'false');
    }
    if (volRange) {
      volRange.value = String(Math.round(audioState.volume * 100));
    }
    if (statusEl) {
      if (audioState.muted) {
        statusEl.textContent = 'الصوت مكتوم — الشرح النصي التكتيكي المتزامن يعمل بالكامل.';
      } else if (audioState.isSpeaking) {
        statusEl.textContent = 'التوجيه النصي المتزامن نشط الآن مع المؤثرات الصوتية الهادئة...';
      } else {
        statusEl.textContent = 'التوجيه النصي المتزامن جاهز — تنبيهات صوتية خفيفة مع خفض تلقائي للموسيقى.';
      }
    }
  }

  function paintCinemaFrame(sample: CinemaTimelineSample, allowSpeechTrigger: boolean): void {
    lastSample = sample;
    const svg = bodyEl.querySelector('#bboxCinemaSvg') as SVGSVGElement | null;
    if (svg) {
      svg.innerHTML = buildCinemaPitchSvgContent(sample);
      svg.setAttribute('data-phase', sample.phase);
      svg.setAttribute('data-rewinding', sample.isRewinding ? 'true' : 'false');
    }

    const phaseBadge = bodyEl.querySelector('#bboxHudPhase') as HTMLElement | null;
    const timecodeEl = bodyEl.querySelector('#bboxHudTime') as HTMLElement | null;
    const freezeBanner = bodyEl.querySelector('#bboxFreezeCallout') as HTMLElement | null;
    const scrubEl = bodyEl.querySelector('#bboxCinemaScrub') as HTMLInputElement | null;
    const playBtn = bodyEl.querySelector('#bboxCinemaPlayBtn') as HTMLButtonElement | null;

    if (phaseBadge) {
      phaseBadge.textContent = PHASE_LABELS[sample.phase];
      phaseBadge.className = `bbox-hud-phase is-${sample.emphasis}`;
    }
    if (timecodeEl) {
      const prefix = sample.isRewinding ? '◀◀ ' : '';
      timecodeEl.textContent = `${prefix}${sample.displaySeconds.toFixed(1)}s`;
      timecodeEl.classList.toggle('is-rewind', sample.isRewinding);
    }
    if (freezeBanner) {
      if (sample.isFrozen) {
        freezeBanner.textContent = scenario.freezeCallout;
        freezeBanner.classList.remove('hidden');
      } else {
        freezeBanner.classList.add('hidden');
      }
    }
    if (scrubEl) {
      scrubEl.value = String(Math.round(sample.globalProgress * 1000));
    }
    if (playBtn) {
      playBtn.textContent = isPlaying ? '⏸ إيقاف مؤقت' : '▶ تشغيل السيناريو';
    }

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-chapter-phase]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.chapterPhase === sample.phase);
    });

    // Update synchronized documentary narrator script card
    const seg = sample.segment;
    const headEl = bodyEl.querySelector('#bboxNarHeading');
    const scriptEl = bodyEl.querySelector('#bboxNarScript');
    const trigEl = bodyEl.querySelector('#bboxNarTrigger');
    const whyEl = bodyEl.querySelector('#bboxNarWhy');
    if (headEl) headEl.textContent = seg.heading;
    if (scriptEl) scriptEl.textContent = seg.spokenScript;
    if (trigEl) trigEl.textContent = seg.trigger;
    if (whyEl) whyEl.textContent = seg.why;

    if (allowSpeechTrigger && lastSpokenPhase !== sample.phase) {
      lastSpokenPhase = sample.phase;
      narrator.speakSegment(seg.spokenScript, 1);
    }
  }

  function startCinemaPlayback(): void {
    const { totalMs } = getCinemaTimelineBounds(scenario);
    if (timelineElapsedMs >= totalMs - 80) {
      timelineElapsedMs = 0;
      lastSpokenPhase = null;
    }
    isPlaying = true;
    narrator.resume();
    lastRafTs = 0;

    // Trigger current phase narration cleanly on playback start
    const initial = sampleBlackBoxTimeline(scenario, timelineElapsedMs);
    paintCinemaFrame(initial, true);

    const tick = (now: number) => {
      if (!isPlaying || step !== 'cinema') return;
      if (lastRafTs === 0) lastRafTs = now;
      const dt = Math.min(64, Math.max(0, now - lastRafTs));
      lastRafTs = now;
      timelineElapsedMs += dt;

      if (timelineElapsedMs >= totalMs) {
        timelineElapsedMs = totalMs;
        paintCinemaFrame(sampleBlackBoxTimeline(scenario, totalMs), false);
        stopPlaybackLoop();
        // Auto-pause narration and transition smoothly to the Interactive Player Challenge
        narrator.cancelSpeech();
        step = 'challenge';
        resetChallengeForScenario(true);
        renderCurrentStep();
        return;
      }

      paintCinemaFrame(sampleBlackBoxTimeline(scenario, timelineElapsedMs), true);
      rafId = window.requestAnimationFrame(tick);
    };

    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = window.requestAnimationFrame(tick);
  }

  function pauseCinemaPlayback(): void {
    stopPlaybackLoop();
    narrator.pause();
    paintCinemaFrame(sampleBlackBoxTimeline(scenario, timelineElapsedMs), false);
  }

  function seekToPhase(phase: Exclude<CinemaPhaseId, 'challenge'>, autoSpeak: boolean): void {
    const { bounds } = getCinemaTimelineBounds(scenario);
    const target = bounds.find((b) => b.phase === phase);
    if (!target) return;
    timelineElapsedMs = target.startMs + 40;
    lastSpokenPhase = null;
    paintCinemaFrame(sampleBlackBoxTimeline(scenario, timelineElapsedMs), autoSpeak);
  }

  function renderCinemaStep(): void {
    const initialSample = sampleBlackBoxTimeline(scenario, timelineElapsedMs);
    bodyEl.innerHTML = `
      <div class="bbox-scenario-bar" role="group" aria-label="اختيار السيناريو التكتيكي">
        ${BLACK_BOX_SCENARIOS.map((sc, idx) => {
          const done = completedScenarioIds.has(sc.id);
          return `
            <button type="button" class="bbox-scenario-btn ${sc.id === scenario.id ? 'active' : ''}" data-sc-pick="${sc.id}">
              <span class="bbox-sc-num" dir="ltr">0${idx + 1}</span>
              <span>${escapeHtml(sc.title)}</span>
              ${done ? '<span class="bbox-sc-done">✓</span>' : ''}
            </button>
          `;
        }).join('')}
      </div>

      <div class="bbox-split">
        <div class="bbox-stage-col">
          <div class="bbox-cinema-hud">
            <span id="bboxHudPhase" class="bbox-hud-phase is-${initialSample.emphasis}">${PHASE_LABELS[initialSample.phase]}</span>
            <span id="bboxHudTime" class="bbox-hud-time" dir="ltr">${initialSample.displaySeconds.toFixed(1)}s</span>
          </div>

          <div class="bbox-pitch-frame">
            <svg id="bboxCinemaSvg" class="bbox-pitch-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="مسرح سينما الإرجاع التكتيكي"></svg>
            <div id="bboxFreezeCallout" class="bbox-freeze-banner hidden" role="status"></div>
          </div>

          <div class="bbox-chapters" role="group" aria-label="مراحل السيناريو">
            ${(['setup', 'error', 'freeze', 'rewind', 'correct'] as const)
              .map(
                (ph) => `
              <button type="button" class="bbox-chapter-btn ${initialSample.phase === ph ? 'active' : ''}" data-chapter-phase="${ph}">
                ${PHASE_LABELS[ph]}
              </button>
            `
              )
              .join('')}
          </div>

          <div class="bbox-scrub-wrap">
            <input id="bboxCinemaScrub" class="bbox-scrub-range" type="range" min="0" max="1000" step="1" value="${Math.round(initialSample.globalProgress * 1000)}" aria-label="شريط الزمن التكتيكي" />
          </div>

          <div class="bbox-playback-row">
            <button type="button" id="bboxCinemaPlayBtn" class="bbox-btn-gold">▶ تشغيل السيناريو</button>
            <button type="button" id="bboxCinemaRewindBtn" class="bbox-btn-secondary">◀◀ إرجاع الزمن</button>
            <button type="button" id="bboxCinemaRestartBtn" class="bbox-btn-secondary">↺ إعادة</button>
          </div>
        </div>

        <div class="bbox-panel-col">
          <div class="bbox-narrator-card">
            <div class="bbox-narrator-top">
              <span class="bbox-tag-label">المحلل التكتيكي • التوجيه المتزامن</span>
              <h3 id="bboxNarHeading">${escapeHtml(initialSample.segment.heading)}</h3>
            </div>
            <p id="bboxNarScript" class="bbox-nar-script">${escapeHtml(initialSample.segment.spokenScript)}</p>
            <div class="bbox-nar-grid">
              <div class="bbox-nar-pill">
                <span>المحفّز المشروط</span>
                <p id="bboxNarTrigger">${escapeHtml(initialSample.segment.trigger)}</p>
              </div>
              <div class="bbox-nar-pill">
                <span>لماذا ينجح هذا القرار</span>
                <p id="bboxNarWhy">${escapeHtml(initialSample.segment.why)}</p>
              </div>
            </div>
          </div>

          <div class="bbox-audio-box" role="region" aria-label="التحكم بالصوت والتوجيه المتزامن">
            <div class="bbox-audio-controls">
              <button type="button" id="bboxAudioMuteBtn" class="bbox-audio-btn">🔊 الصوت</button>
              <button type="button" id="bboxAudioSpeechBtn" class="bbox-audio-btn active">إيقاع الشرح</button>
              <button type="button" id="bboxAudioMusicBtn" class="bbox-audio-btn">موسيقى هادئة</button>
              <label class="bbox-vol-wrap">
                <span>المستوى</span>
                <input id="bboxAudioVolRange" type="range" min="0" max="100" step="5" value="85" aria-label="مستوى الصوت" />
              </label>
            </div>
            <div id="bboxAudioStatus" class="bbox-audio-status"></div>
          </div>

          <div class="bbox-cta-bar">
            <button type="button" id="bboxGoChallengeBtn" class="bbox-btn-gold">
              اختبر قرارك في التحدّي التفاعلي ←
            </button>
          </div>
        </div>
      </div>
    `;

    paintCinemaFrame(initialSample, false);
    syncAudioStrip(narrator.getState());

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-sc-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        narrator.unlockFromUserGesture();
        selectScenario(btn.dataset.scPick as BlackBoxScenarioDef['id'], false);
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-chapter-phase]').forEach((btn) => {
      btn.addEventListener('click', () => {
        narrator.unlockFromUserGesture();
        const ph = btn.dataset.chapterPhase as Exclude<CinemaPhaseId, 'challenge'>;
        seekToPhase(ph, true);
      });
    });

    bodyEl.querySelector('#bboxCinemaScrub')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(val)) return;
      stopPlaybackLoop();
      narrator.cancelSpeech();
      const { totalMs } = getCinemaTimelineBounds(scenario);
      timelineElapsedMs = (val / 1000) * totalMs;
      lastSpokenPhase = null;
      paintCinemaFrame(sampleBlackBoxTimeline(scenario, timelineElapsedMs), false);
    });

    bodyEl.querySelector('#bboxCinemaPlayBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      if (isPlaying) pauseCinemaPlayback();
      else startCinemaPlayback();
    });

    bodyEl.querySelector('#bboxCinemaRewindBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      seekToPhase('rewind', true);
      if (!isPlaying) startCinemaPlayback();
    });

    bodyEl.querySelector('#bboxCinemaRestartBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      stopPlaybackLoop();
      narrator.cancelSpeech();
      timelineElapsedMs = 0;
      lastSpokenPhase = null;
      startCinemaPlayback();
    });

    bodyEl.querySelector('#bboxAudioMuteBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      narrator.toggleMute();
    });

    bodyEl.querySelector('#bboxAudioSpeechBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      const cur = narrator.getState();
      narrator.setSpeechEnabled(!cur.speechEnabled);
    });

    bodyEl.querySelector('#bboxAudioMusicBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      const cur = narrator.getState();
      narrator.setMusicEnabled(!cur.musicEnabled);
    });

    bodyEl.querySelector('#bboxAudioVolRange')?.addEventListener('input', (e) => {
      narrator.unlockFromUserGesture();
      const v = Number((e.target as HTMLInputElement).value) / 100;
      narrator.setVolume(v);
    });

    bodyEl.querySelector('#bboxGoChallengeBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      stopPlaybackLoop();
      narrator.cancelSpeech();
      step = 'challenge';
      resetChallengeForScenario(true);
      renderCurrentStep();
    });
  }

  // =========================================================================
  // STEP 3 — INTERACTIVE PLAYER CHALLENGE (MOBILE DRAG + TAP ZONES) & COMPLETION
  // =========================================================================
  function buildChallengePitchSvgContent(): string {
    const ch = scenario.challenge;
    const frame = ch.initialFrame;
    const svgUid = `${uid}_chg`;

    const zonesHtml = ch.candidateZones
      .map((z) => {
        const revealed = challengeResult !== null;
        const stroke = revealed
          ? z.isCorrect
            ? '#F3D578'
            : '#FB7185'
          : 'rgba(212,175,55,0.68)';
        const fill = revealed
          ? z.isCorrect
            ? 'rgba(212,175,55,0.22)'
            : 'rgba(244,63,94,0.14)'
          : 'rgba(212,175,55,0.1)';
        return `
          <g class="bbox-drop-zone" data-zone-tap="${escapeHtml(z.id)}" data-zx="${z.x}" data-zy="${z.y}" style="cursor:pointer;">
            <circle cx="${px(z.x)}" cy="${py(z.y)}" r="${px(z.r)}" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-dasharray="5 4" />
            <text x="${px(z.x)}" y="${py(z.y) - px(z.r) - 6}" text-anchor="middle" fill="${stroke}" font-size="9" font-weight="800" paint-order="stroke" stroke="#080E0B" stroke-width="3.6" stroke-linejoin="round">${escapeHtml(z.label)}</text>
          </g>
        `;
      })
      .join('');

    // Show helper guide arrow after evaluation
    let guideArrowHtml = '';
    if (challengeResult) {
      const startPt = frame.ourPos[ch.playerIndex];
      const geom = buildCurvedArrowGeometry(
        px(startPt.x),
        py(startPt.y),
        px(ch.targetZone.x),
        py(ch.targetZone.y),
        'run'
      );
      guideArrowHtml = `
        <path d="${geom.pathD}" fill="none" stroke="#F3D578" stroke-width="2.4" stroke-dasharray="6 4" marker-end="url(#${svgUid}_arr_gold)" />
      `;
    }

    const oppHtml = frame.oppPos
      .map((pt, i) => {
        const cx = px(pt.x);
        const cy = py(pt.y);
        return `
          <g>
            <circle cx="${cx}" cy="${cy}" r="11.5" fill="#1F1218" stroke="#FB7185" stroke-width="1.6" />
            <text x="${cx}" y="${cy + 3.4}" text-anchor="middle" fill="#FECDD3" font-size="8.5" font-weight="800" dir="ltr">X${i + 1}</text>
          </g>
        `;
      })
      .join('');

    const ourHtml = frame.ourPos
      .map((basePt, i) => {
        const isTarget = i === ch.playerIndex;
        const pt = isTarget ? challengePlayerPos : basePt;
        const cx = px(pt.x);
        const cy = py(pt.y);

        if (isTarget) {
          const ringColor =
            challengeResult === null
              ? '#F3D578'
              : challengeResult.isCorrect
                ? '#F3D578'
                : '#FB7185';
          const fill =
            challengeResult === null
              ? '#D4AF37'
              : challengeResult.isCorrect
                ? '#D4AF37'
                : '#9F1239';
          const txt = challengeResult && !challengeResult.isCorrect ? '#FFF1F2' : '#090A0C';
          return `
            <g id="bboxChallengeActor" data-challenge-actor="true" style="cursor:grab;">
              <circle cx="${cx}" cy="${cy}" r="23" fill="rgba(212,175,55,0.16)" stroke="${ringColor}" stroke-width="1.8" />
              <circle cx="${cx}" cy="${cy}" r="14.5" fill="${fill}" stroke="#090A0C" stroke-width="2" />
              <text x="${cx}" y="${cy + 3.8}" text-anchor="middle" fill="${txt}" font-size="8.8" font-weight="900" dir="ltr">${SLOT_CODES_221[i]}</text>
            </g>
          `;
        }

        return `
          <g opacity="0.82">
            <circle cx="${cx}" cy="${cy}" r="12" fill="#151922" stroke="rgba(226,232,240,0.48)" stroke-width="1.5" />
            <text x="${cx}" y="${cy + 3.4}" text-anchor="middle" fill="#E2E8F0" font-size="8.2" font-weight="800" dir="ltr">${SLOT_CODES_221[i]}</text>
          </g>
        `;
      })
      .join('');

    const bx = px(frame.ball.x);
    const by = py(frame.ball.y);
    const ballHtml = `
      <g>
        <ellipse cx="${bx}" cy="${by + 6}" rx="6.2" ry="2.8" fill="rgba(0,0,0,0.45)" />
        <circle cx="${bx}" cy="${by}" r="6.2" fill="#F8FAFC" stroke="#090A0C" stroke-width="1.5" />
      </g>
    `;

    return `
      ${buildObsidianPitchBaseSvg(svgUid)}
      ${zonesHtml}
      ${guideArrowHtml}
      ${oppHtml}
      ${ourHtml}
      ${ballHtml}
    `;
  }

  function submitChallengeDecision(pt: Point2D): void {
    challengePlayerPos = {
      x: Math.max(6, Math.min(94, pt.x)),
      y: Math.max(8, Math.min(92, pt.y)),
    };
    challengeResult = evaluateBlackBoxChallenge(scenario, challengePlayerPos);
    if (challengeResult.isCorrect) {
      completedScenarioIds.add(scenario.id);
      updateHeaderProgress();
      narrator.playSoftFeedback('correct');
      narrator.speakSegment(challengeResult.headline, 1);
    } else {
      narrator.playSoftFeedback('mistake');
    }
    renderChallengeStep();
  }

  function renderChallengeStep(): void {
    const ch = scenario.challenge;
    const otherScenario = BLACK_BOX_SCENARIOS.find((s) => s.id !== scenario.id) || BLACK_BOX_SCENARIOS[0];
    const allCompleted = completedScenarioIds.size >= BLACK_BOX_SCENARIOS.length;

    bodyEl.innerHTML = `
      <div class="bbox-scenario-bar" role="group" aria-label="اختيار السيناريو">
        ${BLACK_BOX_SCENARIOS.map((sc, idx) => {
          const done = completedScenarioIds.has(sc.id);
          return `
            <button type="button" class="bbox-scenario-btn ${sc.id === scenario.id ? 'active' : ''}" data-sc-pick="${sc.id}">
              <span class="bbox-sc-num" dir="ltr">0${idx + 1}</span>
              <span>${escapeHtml(sc.title)}</span>
              ${done ? '<span class="bbox-sc-done">✓</span>' : ''}
            </button>
          `;
        }).join('')}
      </div>

      <div class="bbox-split">
        <div class="bbox-stage-col">
          <div class="bbox-cinema-hud">
            <span class="bbox-hud-phase is-correct">تحدّي القرار التفاعلي</span>
            <span class="bbox-hud-hint">اسحب اللاعب الذهبي أو اضغط منطقة</span>
          </div>

          <div class="bbox-pitch-frame bbox-pitch-interactive">
            <svg id="bboxChallengeSvg" class="bbox-pitch-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="application" aria-label="ملعب التحدّي التكتيكي التفاعلي"></svg>
          </div>
        </div>

        <div class="bbox-panel-col">
          <div class="bbox-challenge-card">
            <span class="bbox-tag-label">الموقف التكتيكي</span>
            <h3>${escapeHtml(ch.promptTitle)}</h3>
            <p class="bbox-challenge-desc">${escapeHtml(ch.promptInstruction)}</p>

            <div class="bbox-zone-buttons" role="group" aria-label="خيارات التمركز السريعة">
              ${ch.candidateZones
                .map(
                  (z) => `
                <button type="button" class="bbox-zone-choice-btn" data-choice-zone="${escapeHtml(z.id)}" data-zx="${z.x}" data-zy="${z.y}">
                  <span>${escapeHtml(z.label)}</span>
                  <span class="bbox-zone-arrow" aria-hidden="true">←</span>
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          ${
            challengeResult
              ? `
            <div id="bboxChallengeFeedback" class="bbox-feedback-card ${challengeResult.isCorrect ? 'is-correct' : 'is-mistake'}" role="status" aria-live="polite">
              <div class="bbox-fb-badge">${challengeResult.isCorrect ? '✓ قرار صحيح' : '✕ قرار مكشوف'}</div>
              <h4>${escapeHtml(challengeResult.headline)}</h4>
              <p>${escapeHtml(challengeResult.explanation)}</p>
              <div class="bbox-fb-actions">
                ${
                  !challengeResult.isCorrect
                    ? `<button type="button" id="bboxRetryChallengeBtn" class="bbox-btn-gold">إعادة المحاولة</button>`
                    : !allCompleted
                      ? `<button type="button" id="bboxNextScenarioBtn" class="bbox-btn-gold">السيناريو التالي: ${escapeHtml(otherScenario.title)} ←</button>`
                      : ''
                }
                <button type="button" id="bboxReplayCinemaBtn" class="bbox-btn-secondary">↺ إعادة مشاهدة السينما</button>
              </div>
            </div>
          `
              : `
            <div class="bbox-hint-strip">
              اسحب اللاعب المميّز باللون الذهبي مباشرة على الملعب أو اضغط أحد الخيارات أعلاه لتقييم قرارك فوراً.
            </div>
          `
          }

          ${
            allCompleted
              ? `
            <div id="bboxCompletionCard" class="bbox-completion-card">
              <div class="bbox-kicker" dir="ltr">MISSION COMPLETE • MAYDAN BLACK BOX</div>
              <h4>أتممت مسار الصندوق الأسود التكتيكي بنجاح</h4>
              <p>أثبتّ إتقانك لمبدأَي الخروج بالكرة تحت الضغط وتغطية العمق الدفاعي في تشكيلة 2-2-1.</p>
              <div class="bbox-fb-actions">
                <button type="button" id="bboxBackToDnaBtn" class="bbox-btn-gold">مراجعة Role DNA</button>
                <button type="button" id="bboxRestartAllBtn" class="bbox-btn-secondary">إعادة السيناريو الأول</button>
              </div>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;

    const svg = bodyEl.querySelector('#bboxChallengeSvg') as SVGSVGElement;
    svg.innerHTML = buildChallengePitchSvgContent();

    // Pointer Dragging + Direct Tap-on-Pitch support (Mobile-first touch-action: none)
    svg.addEventListener('pointerdown', (e) => {
      narrator.unlockFromUserGesture();
      const targetEl = e.target as Element | null;
      const zoneGroup = targetEl?.closest('[data-zone-tap]') as SVGGElement | null;
      if (zoneGroup) {
        const zx = Number(zoneGroup.dataset.zx);
        const zy = Number(zoneGroup.dataset.zy);
        if (Number.isFinite(zx) && Number.isFinite(zy)) {
          submitChallengeDecision({ x: zx, y: zy });
        }
        return;
      }

      const rect = svg.getBoundingClientRect();
      const pt = projectClientToPitchPct(e.clientX, e.clientY, rect, SVG_W, SVG_H);
      const distToActor = Math.hypot(pt.x - challengePlayerPos.x, pt.y - challengePlayerPos.y);

      if (distToActor <= 15 || Boolean(targetEl?.closest('[data-challenge-actor]'))) {
        isDraggingChallengePlayer = true;
        dragPointerId = e.pointerId;
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic pointer capture rejection
        }
        challengePlayerPos = pt;
        svg.innerHTML = buildChallengePitchSvgContent();
      } else {
        // Direct tap anywhere on pitch places the actor and evaluates immediately
        submitChallengeDecision(pt);
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!isDraggingChallengePlayer) return;
      if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
      const rect = svg.getBoundingClientRect();
      challengePlayerPos = projectClientToPitchPct(e.clientX, e.clientY, rect, SVG_W, SVG_H);
      svg.innerHTML = buildChallengePitchSvgContent();
    });

    const finishDrag = (e: PointerEvent) => {
      if (!isDraggingChallengePlayer) return;
      if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
      isDraggingChallengePlayer = false;
      dragPointerId = null;
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      const rect = svg.getBoundingClientRect();
      const pt = projectClientToPitchPct(e.clientX, e.clientY, rect, SVG_W, SVG_H);
      submitChallengeDecision(pt);
    };
    svg.addEventListener('pointerup', finishDrag);
    svg.addEventListener('pointercancel', finishDrag);

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-choice-zone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        narrator.unlockFromUserGesture();
        const zx = Number(btn.dataset.zx);
        const zy = Number(btn.dataset.zy);
        if (Number.isFinite(zx) && Number.isFinite(zy)) {
          submitChallengeDecision({ x: zx, y: zy });
        }
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>('[data-sc-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        narrator.unlockFromUserGesture();
        selectScenario(btn.dataset.scPick as BlackBoxScenarioDef['id'], false);
      });
    });

    bodyEl.querySelector('#bboxRetryChallengeBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      resetChallengeForScenario(true);
      renderChallengeStep();
    });

    bodyEl.querySelector('#bboxReplayCinemaBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      step = 'cinema';
      timelineElapsedMs = 0;
      lastSpokenPhase = null;
      renderCurrentStep();
      startCinemaPlayback();
    });

    bodyEl.querySelector('#bboxNextScenarioBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      scenario = otherScenario;
      timelineElapsedMs = 0;
      lastSpokenPhase = null;
      step = 'cinema';
      renderCurrentStep();
      startCinemaPlayback();
    });

    bodyEl.querySelector('#bboxBackToDnaBtn')?.addEventListener('click', () => {
      step = 'dna';
      renderCurrentStep();
    });

    bodyEl.querySelector('#bboxRestartAllBtn')?.addEventListener('click', () => {
      narrator.unlockFromUserGesture();
      scenario = getBlackBoxScenarioById('buildup_under_pressure');
      timelineElapsedMs = 0;
      lastSpokenPhase = null;
      step = 'cinema';
      renderCurrentStep();
      startCinemaPlayback();
    });
  }

  function renderCurrentStep(): void {
    updateHeaderProgress();
    updateStepperActive();
    bodyEl.scrollTop = 0;
    if (step === 'dna') {
      renderDnaStep();
    } else if (step === 'cinema') {
      renderCinemaStep();
    } else {
      renderChallengeStep();
    }
  }

  renderCurrentStep();
}
