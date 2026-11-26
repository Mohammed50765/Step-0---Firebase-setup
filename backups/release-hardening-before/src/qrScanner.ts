import { extractJoinCodeFromQrPayload } from './teamMultiplayer';

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorConstructor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface QrScannerStartOptions {
  videoEl: HTMLVideoElement;
  onDetected: (code: string, rawText: string) => void;
  onError: (msgAr: string) => void;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
    MaydanQrScanner?: {
      start: (
        videoOrOpts: HTMLVideoElement | QrScannerStartOptions,
        onDetected?: (code: string, rawText: string) => void,
        onError?: (msgAr: string) => void
      ) => Promise<() => void>;
      stop: () => void;
      isRunning: () => boolean;
    };
  }
}

class MaydanQrScannerService {
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private running = false;
  private videoEl: HTMLVideoElement | null = null;
  private detector: BarcodeDetectorLike | null = null;
  private lastScanTs = 0;

  isRunning(): boolean {
    return this.running;
  }

  async start(
    videoOrOpts: HTMLVideoElement | QrScannerStartOptions,
    onDetectedArg?: (code: string, rawText: string) => void,
    onErrorArg?: (msgAr: string) => void
  ): Promise<() => void> {
    this.stop();

    const opts: QrScannerStartOptions =
      videoOrOpts && 'videoEl' in videoOrOpts
        ? videoOrOpts
        : {
            videoEl: videoOrOpts as HTMLVideoElement,
            onDetected: onDetectedArg || (() => {}),
            onError: onErrorArg || (() => {}),
          };

    const noopStop = () => this.stop();

    if (
      typeof window === 'undefined' ||
      typeof window.BarcodeDetector !== 'function'
    ) {
      opts.onError('ماسح الكاميرا الفوري غير مدعوم في هذا المتصفح — يمكنك لصق كود الدعوة يدوياً.');
      return noopStop;
    }

    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (Array.isArray(formats) && !formats.includes('qr_code')) {
          opts.onError('ماسح الكاميرا الفوري غير مدعوم في هذا المتصفح — يمكنك لصق كود الدعوة يدوياً.');
          return noopStop;
        }
      } catch {
        // Proceed and let constructor validate
      }
    }

    let detector: BarcodeDetectorLike;
    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      opts.onError('ماسح الكاميرا الفوري غير مدعوم في هذا المتصفح — يمكنك لصق كود الدعوة يدوياً.');
      return noopStop;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      opts.onError('الكاميرا غير مدعومة في هذا المتصفح — يمكنك إدخال كود الانضمام يدوياً.');
      return noopStop;
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
      this.detector = detector;
      opts.videoEl.srcObject = stream;
      opts.videoEl.setAttribute('playsinline', 'true');
      opts.videoEl.muted = true;
      await opts.videoEl.play();

      this.running = true;
      this.lastScanTs = 0;

      const tick = async (ts: number) => {
        if (!this.running || !this.videoEl || !this.detector) return;

        // Throttle scanning to ~8fps for battery/CPU friendliness on mobile
        if (ts - this.lastScanTs >= 120 && this.videoEl.readyState >= 2) {
          this.lastScanTs = ts;
          try {
            const found = await this.detector.detect(this.videoEl);
            const rawText = found && found.length > 0 && found[0]?.rawValue
              ? String(found[0].rawValue)
              : '';
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
      return () => this.stop();
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
      return noopStop;
    }
  }

  stop(): void {
    this.running = false;
    this.detector = null;
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
    start: (videoOrOpts, onDetected, onError) => qrScanner.start(videoOrOpts, onDetected, onError),
    stop: () => qrScanner.stop(),
    isRunning: () => qrScanner.isRunning(),
  };
}
