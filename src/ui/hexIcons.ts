/**
 * HEX-6 INSTRUMENT LANGUAGE — Maydan 6v6
 * Precision geometric SVG icons constructed on a 24×24 hexagonal Swiss-instrument grid.
 * Pure TypeScript + inline SVG (zero external icon libraries, zero JSX).
 */

export type HexIconName =
  | 'team'
  | 'lineup'
  | 'tactics'
  | 'match'
  | 'stats'
  | 'profile'
  | 'attendance'
  | 'readiness'
  | 'invite'
  | 'bench'
  | 'injury'
  | 'settings'
  | 'ball'
  | 'captain';

export interface HexIconRenderOptions {
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

/**
 * Outer precision chamfered hexagon frame (6 edges on a 24×24 coordinate space).
 */
const HEX_FRAME_PATH = 'M12 2.2L20.5 7.1V16.9L12 21.8L3.5 16.9V7.1Z';

/**
 * Inner precision glyph paths for each domain instrument icon.
 * All paths use stroke-width="1.5", geometric angles, and zero organic blobs.
 */
const HEX_GLYPHS: Record<HexIconName, { core: string; accent?: string }> = {
  team: {
    core:
      '<circle cx="12" cy="9.2" r="2.1"/>' +
      '<path d="M7.6 16.5C8.3 14.3 9.9 13.3 12 13.3C14.1 13.3 15.7 14.3 16.4 16.5"/>' +
      '<path d="M6.3 11.4H8.1M15.9 11.4H17.7"/>',
    accent: '<path d="M9.6 4.4L12 3L14.4 4.4"/>',
  },
  lineup: {
    core:
      '<path d="M8 7.5H16M8 12H16M8 16.5H13.2"/>' +
      '<circle cx="15.8" cy="16.5" r="1.2"/>',
    accent: '<path d="M12 3.1V5.1"/>',
  },
  tactics: {
    core:
      '<circle cx="8.4" cy="15.4" r="1.6"/>' +
      '<circle cx="15.6" cy="8.6" r="1.6"/>' +
      '<path d="M9.7 14.1L14.3 9.9M12.3 8.6H15.6V11.9"/>',
    accent: '<path d="M8.4 8.6H10.4"/>',
  },
  match: {
    core:
      '<circle cx="12" cy="12" r="4.6"/>' +
      '<polygon points="12,9.3 14.3,10.7 13.4,13.4 10.6,13.4 9.7,10.7"/>',
    accent: '<path d="M12 4.1V5.9M12 18.1V19.9"/>',
  },
  stats: {
    core:
      '<path d="M8.2 16.5V12.8M12 16.5V8.6M15.8 16.5V10.8"/>' +
      '<path d="M6.8 16.5H17.2"/>',
    accent: '<path d="M10.8 7.4L12 6.2L13.2 7.4"/>',
  },
  profile: {
    core:
      '<path d="M12 6.4L16.2 8.2V12.2C16.2 14.8 14.4 16.6 12 17.6C9.6 16.6 7.8 14.8 7.8 12.2V8.2Z"/>' +
      '<path d="M10.2 11.7L11.5 13L14.1 10.2"/>',
    accent: '<path d="M12 3.2V5"/>',
  },
  attendance: {
    core: '<path d="M8.2 12.3L10.8 14.9L16 9.4"/>',
    accent: '<path d="M9.5 4.4L12 3L14.5 4.4"/>',
  },
  readiness: {
    core:
      '<path d="M6.8 12.2H9.4L10.8 8.8L13.2 15.2L14.6 12.2H17.2"/>',
    accent: '<circle cx="12" cy="5.5" r="0.9"/>',
  },
  invite: {
    core:
      '<path d="M12 15.2V8.2M9.2 10.9L12 8.1L14.8 10.9"/>' +
      '<path d="M8 16.5H16"/>',
    accent: '<path d="M12 3.1V4.8"/>',
  },
  bench: {
    core:
      '<path d="M8.2 10.2H15.8M13.6 8.2L15.8 10.2L13.6 12.2"/>' +
      '<path d="M15.8 14.2H8.2M10.4 12.2L8.2 14.2L10.4 16.2"/>',
    accent: '<path d="M12 3.1V4.8"/>',
  },
  injury: {
    core: '<path d="M12 8.2V15.8M8.2 12H15.8"/>',
    accent: '<path d="M9.5 4.4L12 3L14.5 4.4"/>',
  },
  settings: {
    core:
      '<circle cx="12" cy="12" r="2.6"/>' +
      '<path d="M12 7.2V8.6M12 15.4V16.8M7.2 12H8.6M15.4 12H16.8"/>',
    accent: '<path d="M8.7 8.7L9.7 9.7M14.3 14.3L15.3 15.3"/>',
  },
  ball: {
    core:
      '<circle cx="12" cy="12" r="5"/>' +
      '<path d="M12 7V9.4M16.7 10.5L14.4 11.3M14.9 16L13.5 14M9.1 16L10.5 14M7.3 10.5L9.6 11.3"/>',
    accent: '<circle cx="12" cy="12" r="1.3"/>',
  },
  captain: {
    core:
      '<path d="M7.6 15.4L8.6 9.6L12 12.1L15.4 9.6L16.4 15.4Z"/>',
    accent: '<path d="M12 6.8V8.4"/>',
  },
};

export const HEX_ICON_NAMES = Object.keys(HEX_GLYPHS) as HexIconName[];

export function renderHexIconSvg(name: HexIconName, opts: HexIconRenderOptions = {}): string {
  const glyph = HEX_GLYPHS[name] || HEX_GLYPHS.team;
  const sizeCls = opts.size === 'sm' ? ' hex-icon--sm' : opts.size === 'lg' ? ' hex-icon--lg' : '';
  const activeCls = opts.active ? ' is-active' : '';
  const extraCls = opts.className ? ` ${opts.className}` : '';
  const ariaAttr = opts.label
    ? `role="img" aria-label="${opts.label.replace(/"/g, '&quot;')}"`
    : 'aria-hidden="true"';

  return (
    `<svg class="hex-icon${sizeCls}${activeCls}${extraCls}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" ${ariaAttr}>` +
    `<path class="hex-frame" d="${HEX_FRAME_PATH}"/>` +
    `<g class="hex-core">${glyph.core}</g>` +
    (glyph.accent ? `<g class="hex-accent">${glyph.accent}</g>` : '') +
    `</svg>`
  );
}

/* ==========================================================================
   LIVE HEX-6 ATTENDANCE INSTRUMENT
   6 discrete geometric edges representing proportional match attendance
   ========================================================================== */

export interface HexAttendanceMetrics {
  confirmed: number;
  total: number;
  ratio: number; // 0..1
  pct: number; // 0..100
  litSegments: number; // 0..6
  isComplete: boolean;
  statusLabelAr: string;
}

/**
 * Computes proportional 6-edge illumination for ANY roster size (e.g., 3/6 -> 3, 4/7 -> 3, 7/11 -> 4).
 * Never assumes a team must have exactly 6 players; always preserves exact confirmed/total numbers.
 */
export function computeHexAttendanceSegments(
  confirmedRaw: number,
  totalRaw: number
): HexAttendanceMetrics {
  const confirmed = Math.max(0, Math.floor(Number.isFinite(confirmedRaw) ? confirmedRaw : 0));
  const total = Math.max(0, Math.floor(Number.isFinite(totalRaw) ? totalRaw : 0));

  if (total <= 0) {
    return {
      confirmed,
      total: 0,
      ratio: 0,
      pct: 0,
      litSegments: 0,
      isComplete: false,
      statusLabelAr: 'أضف لاعبين لبدء متابعة الحضور',
    };
  }

  const ratio = Math.max(0, Math.min(1, confirmed / total));
  const pct = Math.round(ratio * 100);

  let litSegments = 0;
  if (confirmed <= 0) {
    litSegments = 0;
  } else if (confirmed >= total) {
    litSegments = 6;
  } else {
    litSegments = Math.max(1, Math.min(5, Math.round(ratio * 6)));
  }

  let statusLabelAr = 'بانتظار تأكيدات اللاعبين';
  if (confirmed >= total) {
    statusLabelAr = 'اكتمال حضور الفريق بالكامل';
  } else if (confirmed >= 6) {
    statusLabelAr = 'نصاب السداسي مكتمل وجاهز للعب';
  } else if (confirmed > 0) {
    const remainingFor6 = Math.max(0, Math.min(total, 6) - confirmed);
    statusLabelAr =
      remainingFor6 > 0
        ? `باقي ${remainingFor6} لاكتمال النصاب الأساسي`
        : 'جاري استكمال بقية الردود';
  }

  return {
    confirmed,
    total,
    ratio,
    pct,
    litSegments,
    isComplete: confirmed >= total && total > 0,
    statusLabelAr,
  };
}

/**
 * Six discrete line segments forming a clockwise regular hexagon starting from top vertex (12 o'clock).
 * Inset slightly with geometric air-gaps at corners for a Swiss chronograph dial look.
 */
const HEX_RING_SEGMENTS: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }> = [
  { x1: 37.8, y1: 6.2, x2: 61.5, y2: 19.9 }, // Segment 1 (Top-Right)
  { x1: 63.2, y1: 22.8, x2: 63.2, y2: 49.2 }, // Segment 2 (Right)
  { x1: 61.5, y1: 52.1, x2: 37.8, y2: 65.8 }, // Segment 3 (Bottom-Right)
  { x1: 34.2, y1: 65.8, x2: 10.5, y2: 52.1 }, // Segment 4 (Bottom-Left)
  { x1: 8.8, y1: 49.2, x2: 8.8, y2: 22.8 }, // Segment 5 (Left)
  { x1: 10.5, y1: 19.9, x2: 34.2, y2: 6.2 }, // Segment 6 (Top-Left)
];

/**
 * Renders the Live 6-Edge Attendance Hexagon SVG (72×72 viewBox).
 * Accessible: pairs visual edges with exact aria-label & companion numeric fraction outside SVG.
 */
export function renderLiveHexAttendanceSvg(confirmed: number, total: number): string {
  const m = computeHexAttendanceSegments(confirmed, total);
  const ariaLabel = `مؤشر الحضور السداسي: ${m.confirmed} من ${m.total} لاعب (${m.pct}%)`;

  const edgesHtml = HEX_RING_SEGMENTS.map((seg, idx) => {
    const isLit = idx < m.litSegments;
    const strokeColor = isLit
      ? m.isComplete
        ? '#F2D675'
        : '#D4AF37'
      : 'rgba(154, 161, 173, 0.24)';
    const strokeW = isLit ? '3.4' : '2.2';
    return (
      `<line class="hex-att-edge${isLit ? ' is-lit' : ''}" ` +
      `data-hex-edge="${idx + 1}" data-lit="${isLit ? '1' : '0'}" ` +
      `x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" ` +
      `stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linecap="square" />`
    );
  }).join('');

  return (
    `<svg class="hex-att-svg" viewBox="0 0 72 72" fill="none" role="img" aria-label="${ariaLabel}">` +
    `<polygon points="36,11 58,23.5 58,48.5 36,61 14,48.5 14,23.5" fill="rgba(9,10,12,0.82)" stroke="rgba(243,244,246,0.06)" stroke-width="1"/>` +
    edgesHtml +
    `</svg>`
  );
}

/**
 * Hydrates any element carrying `data-hex-icon="<name>"` inside a root container.
 * Safe to re-run; preserves existing button handlers, text, and DOM attributes.
 */
export function hydrateHexIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-hex-icon]').forEach((el) => {
    const name = el.dataset.hexIcon as HexIconName | undefined;
    if (!name || !(name in HEX_GLYPHS)) return;
    const size = (el.dataset.hexSize as 'sm' | 'md' | 'lg' | undefined) || 'md';
    el.innerHTML = renderHexIconSvg(name, { size });
  });
}
