import jsQR from 'jsqr';
import { extractJoinCodeFromQrPayload } from './teamMultiplayer';

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
    MaydanQrScanner?: {
      start: (opts: {
        videoEl: HTMLVideoElement;
        onDetected: (code: string, rawText: string) => void;
        onError: (msgAr: string) => void;
      }) => Promise<boolean>;
      stop: () => void;
      isRunning: () => boolean;
    };
  }
}

class MaydanQrScannerService {
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private running = false;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private detector: BarcodeDetectorLike | null = null;
  private lastScanTs = 0;

  isRunning(): boolean {
    return this.running;
  }

  async start(opts: {
    videoEl: HTMLVideoElement;
    onDetected: (code: string, rawText: string) => void;
    onError: (msgAr: string) => void;
  }): Promise<boolean> {
    this.stop();

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      opts.onError('الكاميرا غير مدعومة في هذا المتصفح — يمكنك إدخال كود الانضمام يدوياً.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.stream = stream;
      this.videoEl = opts.videoEl;
      opts.videoEl.srcObject = stream;
      opts.videoEl.setAttribute('playsinline', 'true');
      opts.videoEl.muted = true;
      await opts.videoEl.play();

      if (typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function') {
        try {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          this.detector = null;
        }
      } else {
        this.detector = null;
      }

      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      }

      this.running = true;
      this.lastScanTs = 0;

      const tick = async (ts: number) => {
        if (!this.running || !this.videoEl) return;

        // Throttle scanning to ~8fps for battery/CPU friendliness on mobile
        if (ts - this.lastScanTs >= 120 && this.videoEl.readyState >= 2) {
          this.lastScanTs = ts;
          try {
            let rawText = '';

            if (this.detector) {
              const found = await this.detector.detect(this.videoEl);
              if (found && found.length > 0 && found[0]?.rawValue) {
                rawText = String(found[0].rawValue);
              }
            }

            if (!rawText && this.canvas && this.ctx) {
              const vw = this.videoEl.videoWidth || 640;
              const vh = this.videoEl.videoHeight || 480;
              const scale = Math.min(1, 560 / Math.max(vw, vh));
              const w = Math.max(160, Math.round(vw * scale));
              const h = Math.max(160, Math.round(vh * scale));
              if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
              }
              this.ctx.drawImage(this.videoEl, 0, 0, w, h);
              const imgData = this.ctx.getImageData(0, 0, w, h);
              const qr = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
              if (qr && qr.data) {
                rawText = qr.data;
              }
            }

            if (rawText) {
              const extracted = extractJoinCodeFromQrPayload(rawText);
              if (extracted) {
                this.stop();
                opts.onDetected(extracted, rawText);
                return;
              }
            }
          } catch {
            // Keep scanning smoothly on transient frame errors
          }
        }

        if (this.running) {
          this.rafId = requestAnimationFrame(tick);
        }
      };

      this.rafId = requestAnimationFrame(tick);
      return true;
    } catch (err) {
      this.stop();
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        opts.onError('تم رفض إذن الكاميرا — فعّل صلاحية الكاميرا من إعدادات المتصفح أو أدخل الكود يدوياً.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        opts.onError('لم يتم العثور على كاميرا على هذا الجهاز — أدخل كود الدعوة يدوياً.');
      } else {
        opts.onError('تعذّر تشغيل الكاميرا للمسح — يمكنك لصق كود الدعوة يدوياً.');
      }
      return false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.stream = null;
    }
    if (this.videoEl) {
      try {
        this.videoEl.pause();
        this.videoEl.srcObject = null;
      } catch {
        // ignore
      }
      this.videoEl = null;
    }
  }
}

export const qrScanner = new MaydanQrScannerService();

if (typeof window !== 'undefined') {
  window.MaydanQrScanner = {
    start: (opts) => qrScanner.start(opts),
    stop: () => qrScanner.stop(),
    isRunning: () => qrScanner.isRunning(),
  };
}
