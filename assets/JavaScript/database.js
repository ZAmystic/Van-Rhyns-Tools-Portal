(() => {
    'use strict';
    if (window.supabaseClient) return;
    const config = window.APP_CONFIG;
    try {
        if (!config || !window.supabase?.createClient) {
            throw new Error('Missing local configuration or Supabase library.');
        }
        const url = new URL(config.SUPABASE_URL);
        const key = config.SUPABASE_PUBLISHABLE_KEY;
        if (url.protocol !== 'https:' || typeof key !== 'string' || !key.startsWith('sb_publishable_') || key.length <= 'sb_publishable_'.length) {
            throw new Error('A valid HTTPS project URL and publishable key are required.');
        }
        window.supabaseClient = window.supabase.createClient(url.href, key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
    } catch (error) {
        console.error('[AUTH] Database initialization failed:', error.message);
        window.supabaseClient = null;
    }
})();

// Shared session and profile validation (formerly session.js).
(() => {
    'use strict';
    if (window.PortalAuth) return;
    const messages = Object.freeze({
        required: 'Please log in to access the tools portal.',
        denied: 'Your employee account is not authorised. Contact your administrator.',
        expired: 'Your session has expired. Please log in again.',
        signedout: 'You have been signed out.',
        unavailable: 'Authentication is temporarily unavailable. Please try again.',
        config: 'Authentication is not configured. Contact your administrator.'
    });
    class AuthFailure extends Error {
        constructor(code) { super(messages[code]); this.code = code; }
    }
    function client() {
        if (!window.supabaseClient) throw new AuthFailure('config');
        return window.supabaseClient;
    }
    async function verify() {
        const sb = client();
        const { data: sessionData, error: sessionError } = await sb.auth.getSession();
        if (sessionError) throw new AuthFailure('unavailable');
        if (!sessionData?.session) throw new AuthFailure('required');
        const { data: userData, error: userError } = await sb.auth.getUser();
        if (userError) {
            const status = Number(userError.status);
            throw new AuthFailure([400, 401, 403].includes(status) || userError.name === 'AuthSessionMissingError' ? 'expired' : 'unavailable');
        }
        if (!userData?.user) throw new AuthFailure('expired');
        const user = userData.user;
        const { data: profile, error: profileError } = await sb.from('profiles')
            .select('id, first_name, last_name, role, is_active').eq('id', user.id).maybeSingle();
        if (profileError) {
            console.error('[AUTH] Profile query failed:', profileError.code || 'unknown');
            throw new AuthFailure('unavailable');
        }
        if (!profile || profile.is_active !== true) throw new AuthFailure('denied');
        return { user, profile };
    }
    async function signOut() {
        const { error } = await client().auth.signOut({ scope: 'local' });
        if (error) throw error;
    }
    async function clearRejectedSession() {
        try { await signOut(); }
        catch (error) { console.warn('[AUTH] Sign-out request failed:', error.message); }
    }
    function redirect(file, reason) {
        const target = new URL(file, window.location.href);
        if (reason && Object.hasOwn(messages, reason)) target.searchParams.set('reason', reason);
        if (target.href !== window.location.href) window.location.replace(target.href);
    }
    window.PortalAuth = Object.freeze({ client, verify, signOut, clearRejectedSession, redirect, messages, AuthFailure });
})();
