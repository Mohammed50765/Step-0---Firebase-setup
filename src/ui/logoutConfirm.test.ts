import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGOUT_CONFIRM_COPY,
  getLogoutConfirmCopy,
  LogoutConfirmStateMachine,
} from './logoutConfirm';

test('getLogoutConfirmCopy returns exact Arabic RTL copy by default and English LTR when requested', () => {
  const ar = getLogoutConfirmCopy('ar');
  assert.equal(ar.dir, 'rtl');
  assert.equal(ar.title, 'تسجيل الخروج');
  assert.equal(ar.message, 'هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟');
  assert.equal(ar.confirmLabel, 'نعم، تسجيل الخروج');
  assert.equal(ar.cancelLabel, 'إلغاء');

  assert.deepEqual(getLogoutConfirmCopy(undefined), LOGOUT_CONFIRM_COPY.ar);
  assert.deepEqual(getLogoutConfirmCopy('unknown'), LOGOUT_CONFIRM_COPY.ar);

  const en = getLogoutConfirmCopy('en');
  assert.equal(en.dir, 'ltr');
  assert.equal(en.title, 'Sign Out');
  assert.equal(en.confirmLabel, 'Yes, Sign Out');
  assert.equal(en.cancelLabel, 'Cancel');
});

test('LogoutConfirmStateMachine prevents duplicate opens, allows clean cancel, and locks confirm to once', () => {
  const sm = new LogoutConfirmStateMachine();
  assert.equal(sm.getState(), 'closed');
  assert.equal(sm.isOpen(), false);
  assert.equal(sm.cancel(), false);
  assert.equal(sm.beginConfirm(), false);

  // First open succeeds; duplicate open while open is rejected
  assert.equal(sm.requestOpen('btnLogout'), true);
  assert.equal(sm.getState(), 'open');
  assert.equal(sm.getActiveTriggerId(), 'btnLogout');
  assert.equal(sm.requestOpen('btnSignOutPending'), false);
  assert.equal(sm.getActiveTriggerId(), 'btnLogout');

  // Cancel returns cleanly to closed
  assert.equal(sm.cancel(), true);
  assert.equal(sm.getState(), 'closed');
  assert.equal(sm.getActiveTriggerId(), null);

  // Second entry point opens and confirms exactly once
  assert.equal(sm.requestOpen('btnSignOutPending'), true);
  assert.equal(sm.beginConfirm(), true);
  assert.equal(sm.getState(), 'confirming');
  assert.equal(sm.isConfirming(), true);

  // Duplicate confirms, opens, and cancels while confirming are all rejected
  assert.equal(sm.beginConfirm(), false);
  assert.equal(sm.requestOpen('btnLogout'), false);
  assert.equal(sm.cancel(), false);

  // Finish resets cleanly
  sm.finishConfirm();
  assert.equal(sm.getState(), 'closed');
  assert.equal(sm.isOpen(), false);
});
