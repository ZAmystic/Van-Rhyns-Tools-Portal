(() => {
    'use strict';
    const root = document.documentElement;
    if (!root.hasAttribute('data-protected')) return;
    const auth = window.PortalAuth;
    const logoutButton = document.getElementById('logoutButton');
    const userName = document.getElementById('userName') || document.getElementById('userEmail');
    const status = document.getElementById('authStatus') || document.createElement('section');
    status.id = 'authStatus';
    status.setAttribute('aria-live', 'polite');
    if (!status.isConnected) document.body.prepend(status);
    let checking = false;
    let leaving = false;
    let signOutPending = false;
    const reload = () => window.location.reload();
    const lock = () => root.removeAttribute('data-authorized');
    const make = (tag, cls, text) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text) el.textContent = text;
        return el;
    };
    function render({title, message, code, retry, retryLabel = 'Try again', busy = false}) {
        lock();
        status.dataset.state = busy ? 'loading' : 'error';
        status.setAttribute('role', busy ? 'status' : 'alert');
        const logo = make('img', 'auth-logo');
        logo.src = './assets/Images/Van%20Rhyns%20Attorneys%20Logo%20Mini.png';
        logo.alt = 'Van Rhyns Attorneys';
        logo.addEventListener('error', () => { logo.hidden = true; });
        const eyebrow = make('p', 'auth-eyebrow', 'Van Rhyns Attorneys · Internal tools');
        const icon = make('div', 'auth-symbol');
        icon.setAttribute('aria-hidden', 'true');
        if (!busy) icon.textContent = '!';
        const heading = make('h1', 'auth-title', title);
        const detail = make('p', 'auth-description', message);
        status.replaceChildren(logo, eyebrow, icon, heading, detail);
        if (retry) {
            const actions = make('div', 'auth-actions');
            const button = make('button', 'auth-primary', retryLabel);
            button.type = 'button'; button.addEventListener('click', retry);
            actions.append(button);
            // Do not offer a login redirect during an unconfirmed logout.
            if (!signOutPending) {
                const back = make('a', 'auth-secondary', 'Return to login');
                back.href = './index.html?reason=unavailable'; actions.append(back);
            }
            status.append(actions);
        }
        if (code) status.append(make('p', 'auth-code', 'Reference: ' + code));
        status.append(make('p', 'auth-help', busy ? 'Authorised personnel only' : 'If the problem persists, contact your administrator.'));
    }
    function leave(reason) {
        if (leaving) return;
        leaving = true; lock();
        auth.redirect('./index.html', reason);
    }
    async function check() {
        if (checking || leaving || signOutPending) return;
        checking = true;
        render({title:'Verifying your session', message:'Checking your access to the internal tools portal.', busy:true});
        const timer = setTimeout(() => {
            if (checking && !leaving) render({title:'Connection taking too long', message:'Check your internet connection and reload the portal.', code:'AUTH-TIMEOUT', retry:reload, retryLabel:'Reload portal'});
        }, 15000);
        try {
            if (!auth || !window.supabaseClient) {
                console.error('[AUTH] Check config.js, the Supabase CDN and the updated database.js.');
                render({title:'Unable to open the portal',message:'The authentication service could not start. Reload the page to try again.',code:'AUTH-INIT',retry:reload,retryLabel:'Reload portal'});
                return;
            }
            const {user, profile} = await auth.verify();
            if (leaving) return;
            if (userName) userName.textContent = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || user.email || 'Staff member';
            root.setAttribute('data-authorized', '');
        } catch (error) {
            const code = error?.code;
            if (auth && ['required','expired','denied'].includes(code)) {
                if (code !== 'required') {
                    leaving = true;
                    await auth.clearRejectedSession();
                    leaving = false;
                }
                leave(code);
            } else {
                console.error('[AUTH] Verification failed:', code || error?.name);
                render({title:'Unable to verify your session',message:'We could not confirm your access. Check your connection and try again.',code:'AUTH-VERIFY',retry:check});
            }
        } finally { clearTimeout(timer); checking = false; }
    }
    async function logout() {
        if (leaving || checking) return;
        leaving = true; signOutPending = true;
        if (logoutButton) logoutButton.disabled = true;
        render({title:'Signing out',message:'Closing your session securely.',busy:true});
        try {
            await auth.signOut();
            auth.redirect('./index.html','signedout');
        } catch (error) {
            leaving = false;
            render({title:'Unable to sign out',message:'Your sign-out could not be confirmed. Please try again.',code:'AUTH-SIGNOUT',retry:logout,retryLabel:'Retry sign out'});
        } finally { if (logoutButton) logoutButton.disabled = false; }
    }
    logoutButton?.addEventListener('click', logout);
    window.logout = logout;
    if (auth && window.supabaseClient) {
        window.supabaseClient.auth.onAuthStateChange(event => {
            if (event === 'SIGNED_OUT' && !leaving) leave('signedout');
        });
    }
    window.addEventListener('pageshow', event => { if (event.persisted) check(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') lock();
        else if (status.dataset.state !== 'error') check();
    });
    check();
})();
