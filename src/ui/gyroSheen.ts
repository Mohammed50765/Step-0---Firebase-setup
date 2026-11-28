/**
 * MAYDAN 6V6 — LIVE FLOODLIGHT GYRO-SHEEN CONTROLLER
 * Drives subtle metallic champagne-gold sheen reflection (--sheen-x, --sheen-y)
 * and restrained 4px depth parallax (--sheen-dx, --sheen-dy) inside a single rAF loop.
 * Uses DeviceOrientationEvent on mobile (with safe iOS permission handling) and
 * gracefully falls back to smooth pointer/touch tracking on desktop or unsupported devices.
 */

export interface SheenCoords {
  /** Normalized horizontal sheen position in [0, 100] (%) */
  xPct: number;
  /** Normalized vertical sheen position in [0, 100] (%) */
  yPct: number;
  /** Subtle depth offset in [-4, 4] (px) */
  dxPx: number;
  /** Subtle depth offset in [-4, 4] (px) */
  dyPx: number;
}

const MAX_PARALLAX_PX = 4;

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return (min + max) / 2;
  return Math.max(min, Math.min(max, val));
}

/**
 * Pure mapper: converts mobile DeviceOrientation gamma (-35..+35 deg) & beta (10..80 deg)
 * into bounded sheen percentages [0..100] and <=4px parallax offsets.
 */
export function mapOrientationToSheen(gamma: number | null, beta: number | null): SheenCoords {
  const g = clamp(typeof gamma === 'number' ? gamma : 0, -35, 35);
  // Typical comfortable portrait phone tilt centers around 45 degrees
  const bCentered = clamp((typeof beta === 'number' ? beta : 45) - 45, -35, 35);

  const nx = g / 35; // -1..1
  const ny = bCentered / 35; // -1..1

  return {
    xPct: Number((50 + nx * 38).toFixed(2)),
    yPct: Number((50 + ny * 34).toFixed(2)),
    dxPx: Number((nx * MAX_PARALLAX_PX).toFixed(2)),
    dyPx: Number((ny * MAX_PARALLAX_PX).toFixed(2)),
  };
}

/**
 * Pure mapper: converts pointer coordinates inside viewport to bounded sheen & <=4px parallax.
 */
export function mapPointerToSheen(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number
): SheenCoords {
  const w = Math.max(1, viewportWidth || 1);
  const h = Math.max(1, viewportHeight || 1);
  const nx = clamp((clientX / w) * 2 - 1, -1, 1);
  const ny = clamp((clientY / h) * 2 - 1, -1, 1);

  return {
    xPct: Number((50 + nx * 36).toFixed(2)),
    yPct: Number((50 + ny * 32).toFixed(2)),
    dxPx: Number((nx * MAX_PARALLAX_PX).toFixed(2)),
    dyPx: Number((ny * MAX_PARALLAX_PX).toFixed(2)),
  };
}

interface DeviceOrientationWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class GyroSheenController {
  private target: HTMLElement;
  private current: SheenCoords = { xPct: 50, yPct: 36, dxPx: 0, dyPx: 0 };
  private desired: SheenCoords = { xPct: 50, yPct: 36, dxPx: 0, dyPx: 0 };
  private rafId: number | null = null;
  private active = false;
  private gyroListening = false;
  private iosPermissionTried = false;
  private disposed = false;

  constructor(target: HTMLElement) {
    this.target = target;
    this.applyVars(this.current);
  }

  private isMotionRestricted(): boolean {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dataSaver =
      typeof document !== 'undefined' && document.body.classList.contains('data-saver');
    return reduced || dataSaver;
  }

  private applyVars(c: SheenCoords): void {
    this.target.style.setProperty('--sheen-x', `${c.xPct}%`);
    this.target.style.setProperty('--sheen-y', `${c.yPct}%`);
    this.target.style.setProperty('--sheen-dx', `${c.dxPx}px`);
    this.target.style.setProperty('--sheen-dy', `${c.dyPx}px`);
  }

  private scheduleFrame(): void {
    if (this.rafId !== null || !this.active || this.disposed) return;
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.rafId = null;
    if (!this.active || this.disposed) return;

    const lerp = 0.14;
    this.current = {
      xPct: this.current.xPct + (this.desired.xPct - this.current.xPct) * lerp,
      yPct: this.current.yPct + (this.desired.yPct - this.current.yPct) * lerp,
      dxPx: this.current.dxPx + (this.desired.dxPx - this.current.dxPx) * lerp,
      dyPx: this.current.dyPx + (this.desired.dyPx - this.current.dyPx) * lerp,
    };

    this.applyVars({
      xPct: Number(this.current.xPct.toFixed(2)),
      yPct: Number(this.current.yPct.toFixed(2)),
      dxPx: Number(this.current.dxPx.toFixed(2)),
      dyPx: Number(this.current.dyPx.toFixed(2)),
    });

    const delta =
      Math.abs(this.desired.xPct - this.current.xPct) +
      Math.abs(this.desired.yPct - this.current.yPct);
    if (delta > 0.15) {
      this.scheduleFrame();
    }
  };

  private handleOrientation = (ev: DeviceOrientationEvent): void => {
    if (!this.active || this.disposed) return;
    if (ev.gamma === null && ev.beta === null) return;
    this.desired = mapOrientationToSheen(ev.gamma, ev.beta);
    this.scheduleFrame();
  };

  private handlePointerMove = (ev: PointerEvent): void => {
    if (!this.active || this.disposed) return;
    this.desired = mapPointerToSheen(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight);
    this.scheduleFrame();
  };

  private attachGyroListener(): void {
    if (this.gyroListening || this.disposed) return;
    this.gyroListening = true;
    window.addEventListener('deviceorientation', this.handleOrientation, { passive: true });
  }

  /**
   * Safely attempts iOS 13+ DeviceOrientation permission inside a direct user touch gesture
   * without surfacing intrusive errors or blocking fallback pointer tracking.
   */
  public requestGyroFromGesture(): void {
    if (this.disposed || this.iosPermissionTried || this.gyroListening || this.isMotionRestricted()) {
      return;
    }
    this.iosPermissionTried = true;
    try {
      const Doe = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationWithPermission })
        .DeviceOrientationEvent;
      if (!Doe) return;
      if (typeof Doe.requestPermission === 'function') {
        Doe.requestPermission()
          .then((state) => {
            if (state === 'granted' && this.active && !this.disposed) {
              this.attachGyroListener();
            }
          })
          .catch(() => {
            // Permission declined or unsupported — smooth pointer fallback remains active
          });
      } else {
        this.attachGyroListener();
      }
    } catch {
      // Ignore sensor access errors
    }
  }

  public start(): void {
    if (this.active || this.disposed) return;
    if (this.isMotionRestricted()) {
      this.applyVars({ xPct: 50, yPct: 36, dxPx: 0, dyPx: 0 });
      return;
    }
    this.active = true;
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });

    try {
      const Doe = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationWithPermission })
        .DeviceOrientationEvent;
      if (Doe && typeof Doe.requestPermission !== 'function') {
        this.attachGyroListener();
      }
    } catch {
      // Fallback pointer tracking is already active
    }
  }

  public stop(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('pointermove', this.handlePointerMove);
    if (this.gyroListening) {
      window.removeEventListener('deviceorientation', this.handleOrientation);
      this.gyroListening = false;
    }
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public destroy(): void {
    this.stop();
    this.disposed = true;
  }
}
