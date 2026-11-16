/* Local protected-page controller: correct paths from tools/metrofile/. */
(() => {
    'use strict';
    const root = document.documentElement;
    const status = document.getElementById('authStatus');
    const auth = window.PortalAuth;
    const login = '../../index.html';
    let checking = false, leaving = false;
    function show(title, message, busy = false, retry = null) {
        root.removeAttribute('data-authorized');
        status.dataset.state = busy ? 'loading' : 'error';
        status.setAttribute('role', busy ? 'status' : 'alert');
        status.querySelector('.auth-symbol').textContent = busy ? '' : '!';
        status.querySelector('.auth-title').textContent = title;
        status.querySelector('.auth-description').textContent = message;
        const actions = status.querySelector('.auth-actions');
        actions.replaceChildren();
        if (retry) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'auth-primary'; button.textContent = 'Try again';
            button.addEventListener('click', retry); actions.append(button);
            const link = document.createElement('a'); link.className = 'auth-secondary';
            link.href = login + '?reason=unavailable'; link.textContent = 'Return to login'; actions.append(link);
        }
    }
    function redirect(reason) {
        root.removeAttribute('data-authorized');
        const target = new URL(login, location.href); target.searchParams.set('reason', reason);
        if (target.href !== location.href) location.replace(target.href);
    }
    async function verify() {
        if (checking || leaving) return;
        checking = true;
        const initiallyLocked = !root.hasAttribute('data-authorized');
        if (initiallyLocked) show('Verifying your session', 'Checking access to MetroFile Organizer.', true);
        const timer = setTimeout(() => show('Connection taking too long', 'Check your connection and reload to continue.', false, () => location.reload()), 15000);
        try {
            if (!auth || !window.supabaseClient) throw new Error('Authentication configuration missing');
            const { user, profile } = await auth.verify();
            if (leaving) return;
            document.getElementById('staffName').textContent = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.email || 'Staff member';
            root.setAttribute('data-authorized', '');
        } catch (error) {
            if (leaving) return;
            if (['required','expired','denied'].includes(error?.code)) {
                leaving = true; root.removeAttribute('data-authorized');
                if (error.code !== 'required') await auth.clearRejectedSession();
                redirect(error.code);
            } else {
                console.error('[METROFILE AUTH] Verification failed:', error?.code || error?.name);
                show('Unable to verify your session', 'Check your connection and try again. Your storage records remain protected.', false, () => location.reload());
            }
        } finally { clearTimeout(timer); checking = false; }
    }
    async function logout() {
        if (leaving) return;
        leaving = true; show('Signing out', 'Closing your session securely.', true);
        try { await auth.signOut(); redirect('signedout'); }
        catch { leaving = false; show('Unable to sign out', 'Your sign-out could not be confirmed. Please retry.', false, logout); }
    }
    document.getElementById('logoutButton').addEventListener('click', logout);
    window.supabaseClient?.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT' && !leaving) { leaving = true; redirect('signedout'); }
    });
    window.addEventListener('pageshow', event => { if (event.persisted) verify(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !leaving) verify(); });
    verify();
})();
