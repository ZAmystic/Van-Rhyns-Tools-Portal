(() => {
    'use strict';
    // Support the original login markup as well as the updated template.
    const form = document.getElementById('loginForm') || document.querySelector('form.login-form');
    const button = form?.querySelector('.login-button') || form?.querySelector('button[type="submit"]');
    const email = document.getElementById('email') || form?.querySelector('input[type="email"]');
    const password = document.getElementById('password') || form?.querySelector('input[type="password"]');
    let errorBox = document.getElementById('loginError');
    if (!form || !button || !email || !password) {
        // Prevent native form submission if the required controls are missing.
        form?.addEventListener('submit', event => event.preventDefault());
        if (button) button.disabled = true;
        const notice = document.createElement('div');
        notice.className = 'login-error';
        notice.setAttribute('role', 'alert');
        notice.textContent = 'The login page is incomplete. Reload the page or contact your administrator.';
        (form || document.querySelector('.login-card') || document.body).prepend(notice);
        console.error('[AUTH] Missing login controls:', { form: !form, button: !button, email: !email, password: !password });
        return;
    }
    if (!errorBox) {
        errorBox = document.createElement('div');
        errorBox.id = 'loginError';
        errorBox.className = 'login-error';
        errorBox.setAttribute('role', 'alert');
        errorBox.hidden = true;
        button.before(errorBox);
    }
    const buttonText = button.querySelector('span');
    // Keep an existing text-only button and its icon intact.
    const textNode = buttonText ? null : Array.from(button.childNodes || []).find(node => node.nodeType === 3 && node.textContent.trim());
    const originalLabel = buttonText?.textContent?.trim() || textNode?.textContent?.trim() || 'Log in';
    const auth = window.PortalAuth;
    let busy = false;
    let navigating = false;
    function showError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
    function loading(active, label = 'Logging in…') {
        busy = active;
        button.disabled = active;
        if (buttonText) buttonText.textContent = active ? label : originalLabel;
        else if (textNode) textNode.textContent = active ? label : originalLabel;
        form.setAttribute('aria-busy', String(active));
    }
    function openPortal() {
        navigating = true;
        auth.redirect('./portal.html');
    }
    async function handleFailure(error) {
        const code = error?.code;
        if (code === 'denied' || code === 'expired') await auth.clearRejectedSession();
        showError(auth.messages[code] || auth.messages.unavailable);
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || navigating) return;
        showError('');
        if (!auth || !window.supabaseClient) {
            showError('Authentication is not configured. Contact your administrator.');
            return;
        }
        if (!form.reportValidity()) return;
        loading(true);
        try {
            const { data, error } = await auth.client().auth.signInWithPassword({
                email: email.value.trim(), password: password.value
            });
            if (error || !data?.session) {
                const status = Number(error?.status);
                showError(status === 429 ? 'Too many attempts. Please try again later.' :
                    !error || status >= 500 || !status ? auth.messages.unavailable : 'Unable to log in. Check your email and password.');
                return;
            }
            await auth.verify();
            password.value = '';
            openPortal();
        } catch (error) {
            await handleFailure(error);
        } finally {
            if (!navigating) loading(false);
        }
    });
    async function initialize() {
        loading(true, 'Checking session…');
        try {
            if (!auth || !window.supabaseClient) {
                showError('Authentication is not configured. Contact your administrator.');
                return;
            }
            // A guard rejection or logout must NOT trigger another automatic redirect.
            const reason = new URLSearchParams(window.location.search).get('reason');
            if (reason && Object.hasOwn(auth.messages, reason)) {
                if (reason !== 'signedout') showError(auth.messages[reason]);
                return;
            }
            await auth.verify();
            openPortal();
        } catch (error) {
            if (error?.code !== 'required') await handleFailure(error);
        } finally {
            if (!navigating) {
                loading(false);
                if (!auth || !window.supabaseClient) button.disabled = true;
            }
        }
    }
    initialize();
})();
