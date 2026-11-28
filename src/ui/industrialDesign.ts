/**
 * MAYDAN 6V6 — INDUSTRIAL DESIGN & SIGNATURE UX SYSTEM 1.0 BOOTSTRAP
 * Loads Obsidian Design Tokens CSS, hydrates HEX-6 Instrument Icons,
 * and exposes `window.MaydanDesign` for seamless integration with `index.html`.
 */

import '../styles/designTokens.css';
import '../styles/tunnelLogin.css';
import {
  HEX_ICON_NAMES,
  renderHexIconSvg,
  computeHexAttendanceSegments,
  renderLiveHexAttendanceSvg,
  hydrateHexIcons,
} from './hexIcons';
import {
  CHRONO_DETENT_THRESHOLD,
  computeChronoProgress,
  isChronoDetentReached,
  ChronoInvocationGuard,
  ChronoLockSlider,
} from './ChronoLockSlider';
import {
  TunnelApertureController,
  resolveEntranceProfile,
  computeTunnelAudioGain,
  hasUpcomingMatchWithinHours,
  TunnelEntranceSessionGuard,
} from './tunnelEntrance';
import { EntryAudioEngine, ENTRY_AUDIO_SPEC } from './entryAudio';
import { GyroSheenController, mapOrientationToSheen, mapPointerToSheen } from './gyroSheen';
import {
  LogoutConfirmController,
  LogoutConfirmStateMachine,
  LOGOUT_CONFIRM_COPY,
  getLogoutConfirmCopy,
} from './logoutConfirm';

export interface MaydanDesignGlobal {
  HEX_ICON_NAMES: typeof HEX_ICON_NAMES;
  CHRONO_DETENT_THRESHOLD: typeof CHRONO_DETENT_THRESHOLD;
  renderHexIconSvg: typeof renderHexIconSvg;
  computeHexAttendanceSegments: typeof computeHexAttendanceSegments;
  renderLiveHexAttendanceSvg: typeof renderLiveHexAttendanceSvg;
  hydrateHexIcons: typeof hydrateHexIcons;
  computeChronoProgress: typeof computeChronoProgress;
  isChronoDetentReached: typeof isChronoDetentReached;
  ChronoInvocationGuard: typeof ChronoInvocationGuard;
  ChronoLockSlider: typeof ChronoLockSlider;
  TunnelApertureController: typeof TunnelApertureController;
  EntryAudioEngine: typeof EntryAudioEngine;
  GyroSheenController: typeof GyroSheenController;
  LogoutConfirmController: typeof LogoutConfirmController;
  tunnelEntrance: TunnelApertureController | null;
  logoutConfirm: LogoutConfirmController | null;
}

declare global {
  interface Window {
    MaydanDesign?: MaydanDesignGlobal;
    __maydanNextMatchMs?: number | null;
  }
}

const api: MaydanDesignGlobal = {
  HEX_ICON_NAMES,
  CHRONO_DETENT_THRESHOLD,
  renderHexIconSvg,
  computeHexAttendanceSegments,
  renderLiveHexAttendanceSvg,
  hydrateHexIcons,
  computeChronoProgress,
  isChronoDetentReached,
  ChronoInvocationGuard,
  ChronoLockSlider,
  TunnelApertureController,
  EntryAudioEngine,
  GyroSheenController,
  LogoutConfirmController,
  tunnelEntrance: null,
  logoutConfirm: null,
};

if (typeof window !== 'undefined') {
  window.MaydanDesign = api;
  const runHydration = () => {
    hydrateHexIcons(document);
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen && !api.tunnelEntrance) {
      api.tunnelEntrance = new TunnelApertureController({
        loginScreen,
        skipBtn: document.getElementById('btnSkipTunnel') as HTMLButtonElement | null,
        hexSealEl: document.getElementById('inviteHexSeal'),
        getUpcomingMatchTimestampsMs: () => {
          const ts = window.__maydanNextMatchMs;
          return typeof ts === 'number' && Number.isFinite(ts) ? [ts] : [];
        },
      });
      if (!loginScreen.classList.contains('hidden')) {
        api.tunnelEntrance.onLoginVisible();
      }
    }
    const logoutModal = document.getElementById('logoutConfirmModal');
    const confirmBtn = document.getElementById('btnConfirmLogout') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('btnCancelLogout') as HTMLButtonElement | null;
    if (logoutModal && confirmBtn && cancelBtn && !api.logoutConfirm) {
      api.logoutConfirm = new LogoutConfirmController({
        modalEl: logoutModal,
        confirmBtn,
        cancelBtn,
        getLang: () => {
          const loginEl = document.getElementById('loginScreen');
          if (loginEl && !loginEl.classList.contains('hidden') && loginEl.getAttribute('dir') === 'ltr') {
            return 'en';
          }
          return document.documentElement.getAttribute('dir') === 'ltr' ? 'en' : 'ar';
        },
      });
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runHydration, { once: true });
  } else {
    runHydration();
  }
}

export {
  HEX_ICON_NAMES,
  CHRONO_DETENT_THRESHOLD,
  renderHexIconSvg,
  computeHexAttendanceSegments,
  renderLiveHexAttendanceSvg,
  hydrateHexIcons,
  computeChronoProgress,
  isChronoDetentReached,
  ChronoInvocationGuard,
  ChronoLockSlider,
  TunnelApertureController,
  EntryAudioEngine,
  ENTRY_AUDIO_SPEC,
  GyroSheenController,
  mapOrientationToSheen,
  mapPointerToSheen,
  LogoutConfirmController,
  LogoutConfirmStateMachine,
  LOGOUT_CONFIRM_COPY,
  getLogoutConfirmCopy,
  resolveEntranceProfile,
  computeTunnelAudioGain,
  hasUpcomingMatchWithinHours,
  TunnelEntranceSessionGuard,
};
