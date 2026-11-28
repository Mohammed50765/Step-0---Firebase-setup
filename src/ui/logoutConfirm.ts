/**
 * MAYDAN 6V6 — LOGOUT CONFIRMATION DIALOG LAYER
 * Pure state machine + accessible DOM controller kept strictly separate from
 * the underlying sign-out operation (`handleSignOut`).
 */

export type LogoutDialogLang = 'ar' | 'en';
export type LogoutConfirmState = 'closed' | 'open' | 'confirming';

export interface LogoutConfirmCopy {
  lang: LogoutDialogLang;
  dir: 'rtl' | 'ltr';
  title: string;
  message: string;
  confirmLabel: string;
  confirmBusyLabel: string;
  cancelLabel: string;
}

export const LOGOUT_CONFIRM_COPY: Record<LogoutDialogLang, LogoutConfirmCopy> = {
  ar: {
    lang: 'ar',
    dir: 'rtl',
    title: 'تسجيل الخروج',
    message: 'هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟',
    confirmLabel: 'نعم، تسجيل الخروج',
    confirmBusyLabel: 'جاري تسجيل الخروج...',
    cancelLabel: 'إلغاء',
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    title: 'Sign Out',
    message: 'Are you sure you want to sign out of your account?',
    confirmLabel: 'Yes, Sign Out',
    confirmBusyLabel: 'Signing out...',
    cancelLabel: 'Cancel',
  },
};

export function getLogoutConfirmCopy(lang?: string | null): LogoutConfirmCopy {
  return lang === 'en' ? LOGOUT_CONFIRM_COPY.en : LOGOUT_CONFIRM_COPY.ar;
}

/**
 * Pure, deterministic state machine that guarantees:
 * - Duplicate open triggers are ignored while open or confirming.
 * - Cancel is only allowed while open (never mid-signout).
 * - Confirm executes at most once per confirmation cycle.
 */
export class LogoutConfirmStateMachine {
  private state: LogoutConfirmState = 'closed';
  private activeTriggerId: string | null = null;

  getState(): LogoutConfirmState {
    return this.state;
  }

  getActiveTriggerId(): string | null {
    return this.activeTriggerId;
  }

  isOpen(): boolean {
    return this.state === 'open' || this.state === 'confirming';
  }

  isConfirming(): boolean {
    return this.state === 'confirming';
  }

  requestOpen(triggerId?: string | null): boolean {
    if (this.state !== 'closed') return false;
    this.state = 'open';
    this.activeTriggerId = triggerId || null;
    return true;
  }

  cancel(): boolean {
    if (this.state !== 'open') return false;
    this.state = 'closed';
    this.activeTriggerId = null;
    return true;
  }

  beginConfirm(): boolean {
    if (this.state !== 'open') return false;
    this.state = 'confirming';
    return true;
  }

  finishConfirm(): void {
    this.state = 'closed';
    this.activeTriggerId = null;
  }
}

export interface LogoutConfirmControllerOptions {
  modalEl: HTMLElement;
  boxEl?: HTMLElement | null;
  titleEl?: HTMLElement | null;
  messageEl?: HTMLElement | null;
  confirmBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  getLang?: () => LogoutDialogLang;
}

export class LogoutConfirmController {
  private readonly modalEl: HTMLElement;
  private readonly boxEl: HTMLElement | null;
  private readonly titleEl: HTMLElement | null;
  private readonly messageEl: HTMLElement | null;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly getLang: () => LogoutDialogLang;
  private readonly machine = new LogoutConfirmStateMachine();

  private pendingConfirmAction: (() => void | Promise<void>) | null = null;
  private returnFocusEl: HTMLElement | null = null;
  private boundKeydown: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: LogoutConfirmControllerOptions) {
    this.modalEl = options.modalEl;
    this.boxEl = options.boxEl ?? options.modalEl.querySelector<HTMLElement>('.logout-confirm-box');
    this.titleEl = options.titleEl ?? options.modalEl.querySelector<HTMLElement>('#logoutConfirmTitle');
    this.messageEl = options.messageEl ?? options.modalEl.querySelector<HTMLElement>('#logoutConfirmMessage');
    this.confirmBtn = options.confirmBtn;
    this.cancelBtn = options.cancelBtn;
    this.getLang = options.getLang ?? (() => 'ar');

    this.cancelBtn.addEventListener('click', () => {
      this.cancel();
    });

    this.confirmBtn.addEventListener('click', () => {
      void this.confirm();
    });

    this.modalEl.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.modalEl) {
        this.cancel();
      }
    });
  }

  getState(): LogoutConfirmState {
    return this.machine.getState();
  }

  isOpen(): boolean {
    return this.machine.isOpen();
  }

  open(onConfirm: () => void | Promise<void>, triggerEl?: HTMLElement | null): boolean {
    const triggerId = triggerEl?.id || null;
    if (!this.machine.requestOpen(triggerId)) {
      return false;
    }

    this.pendingConfirmAction = onConfirm;
    this.returnFocusEl =
      triggerEl && triggerEl instanceof HTMLElement
        ? triggerEl
        : (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    this.syncCopy(false);
    this.confirmBtn.disabled = false;
    this.cancelBtn.disabled = false;
    this.confirmBtn.removeAttribute('aria-busy');
    this.modalEl.setAttribute('data-logout-state', 'open');
    this.modalEl.classList.remove('hidden');
    this.modalEl.setAttribute('aria-hidden', 'false');

    this.attachKeydown();

    // Place initial focus on the safe Cancel button so accidental Enter never signs out.
    requestAnimationFrame(() => {
      if (this.machine.getState() === 'open') {
        try {
          this.cancelBtn.focus({ preventScroll: true });
        } catch {
          this.cancelBtn.focus();
        }
      }
    });

    return true;
  }

  cancel(): boolean {
    if (!this.machine.cancel()) {
      return false;
    }

    this.pendingConfirmAction = null;
    this.detachKeydown();
    this.modalEl.setAttribute('data-logout-state', 'closed');
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.restoreFocus();
    return true;
  }

  async confirm(): Promise<boolean> {
    if (!this.machine.beginConfirm()) {
      return false;
    }

    const action = this.pendingConfirmAction;
    this.pendingConfirmAction = null;
    this.confirmBtn.disabled = true;
    this.cancelBtn.disabled = true;
    this.confirmBtn.setAttribute('aria-busy', 'true');
    this.modalEl.setAttribute('data-logout-state', 'confirming');
    this.syncCopy(true);

    try {
      if (typeof action === 'function') {
        await action();
      }
    } finally {
      this.machine.finishConfirm();
      this.detachKeydown();
      this.confirmBtn.disabled = false;
      this.cancelBtn.disabled = false;
      this.confirmBtn.removeAttribute('aria-busy');
      this.modalEl.setAttribute('data-logout-state', 'closed');
      this.modalEl.classList.add('hidden');
      this.modalEl.setAttribute('aria-hidden', 'true');
    }

    return true;
  }

  private syncCopy(busy: boolean): void {
    const copy = getLogoutConfirmCopy(this.getLang());
    this.modalEl.setAttribute('dir', copy.dir);
    this.modalEl.setAttribute('lang', copy.lang);
    if (this.boxEl) {
      this.boxEl.setAttribute('dir', copy.dir);
    }
    if (this.titleEl) this.titleEl.textContent = copy.title;
    if (this.messageEl) this.messageEl.textContent = copy.message;
    this.confirmBtn.textContent = busy ? copy.confirmBusyLabel : copy.confirmLabel;
    this.cancelBtn.textContent = copy.cancelLabel;
  }

  private attachKeydown(): void {
    if (this.boundKeydown) return;
    this.boundKeydown = (e: KeyboardEvent) => {
      if (!this.machine.isOpen()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
        return;
      }

      if (e.key === 'Tab') {
        const focusables = [this.confirmBtn, this.cancelBtn].filter((btn) => !btn.disabled);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !this.modalEl.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !this.modalEl.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
        return;
      }

      if (e.key === 'Enter') {
        // Only allow native activation when focus is explicitly on one of the two dialog buttons.
        if (document.activeElement !== this.confirmBtn && document.activeElement !== this.cancelBtn) {
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', this.boundKeydown, true);
  }

  private detachKeydown(): void {
    if (!this.boundKeydown) return;
    document.removeEventListener('keydown', this.boundKeydown, true);
    this.boundKeydown = null;
  }

  private restoreFocus(): void {
    const target = this.returnFocusEl;
    this.returnFocusEl = null;
    if (target && target.isConnected && !target.classList.contains('hidden')) {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }
  }
}
