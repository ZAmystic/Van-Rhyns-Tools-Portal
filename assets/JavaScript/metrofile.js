(async () => {
    'use strict';

    // Shared application configuration. Resolve relative to this script,
    // not the current page, so nested tools and GitHub subpaths work.
    let MODE, CONFIG;
    try {
        const scriptUrl = document.currentScript?.src;
        const configUrl = scriptUrl
            ? new URL('../Config/environment.json', scriptUrl)
            : new URL('./assets/Config/environment.json', document.baseURI);
        const response = await fetch(configUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Configuration HTTP ${response.status}`);
        const settings = await response.json();
        MODE = settings.mode;
        if (!['demo', 'production'].includes(MODE)) throw new Error('Invalid environment mode.');
        CONFIG = settings.environments?.[MODE];
        if (!CONFIG || !['filesTable', 'binsTable', 'auditTable'].every(key =>
            typeof CONFIG[key] === 'string' && CONFIG[key].length > 0) ||
            typeof CONFIG.showEnvironmentLabel !== 'boolean' ||
            typeof CONFIG.environmentLabel !== 'string') {
            throw new Error('Incomplete MetroFile environment settings.');
        }
    } catch (error) {
        console.error('[METROFILE] Configuration could not load:', error.message);
        const summary = document.getElementById('storageSummary');
        if (summary) summary.textContent = 'Environment configuration unavailable. Reload to retry.';
        for (const id of ['officePercentage', 'remotePercentage', 'officeCount', 'remoteCount']) {
            const element = document.getElementById(id);
            if (element) element.textContent = '—';
        }
        for (const id of ['officeSegment', 'remoteSegment']) {
            const element = document.getElementById(id);
            if (element) element.style.width = '0%';
        }
        return; // Never silently fall back to another database environment.
    }

    const TABLE = CONFIG.filesTable;
    const suffix = CONFIG.showEnvironmentLabel && CONFIG.environmentLabel
        ? ` · ${CONFIG.environmentLabel}`
        : '';

    // ========================================
    // DASHBOARD ELEMENTS
    // ========================================

    const root = document.documentElement;
    const ids = ['officePercentage', 'remotePercentage', 'officeCount',
        'remoteCount', 'officeSegment', 'remoteSegment', 'storageSummary'];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    const missing = ids.filter(id => !el[id]);
    if (missing.length) {
        console.warn('[METROFILE] Missing dashboard elements:', missing.join(', '));
        return;
    }

    const number = new Intl.NumberFormat('en-ZA');
    const percent = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1 });
    const validCount = n => Number.isSafeInteger(n) && n >= 0;
    const authorized = () => root.hasAttribute('data-protected') && root.hasAttribute('data-authorized');
    let requestVersion = 0;
    let controller = null;
    el.storageSummary.setAttribute('aria-live', 'polite');

    // ========================================
    // DASHBOARD RENDERING
    // ========================================

    function clear(message) {
        el.officePercentage.textContent = '—';
        el.remotePercentage.textContent = '—';
        el.officeCount.textContent = '— files';
        el.remoteCount.textContent = '— files';
        el.officeSegment.style.width = '0%';
        el.remoteSegment.style.width = '0%';
        el.storageSummary.textContent = message + suffix;
    }

    function render(office, remote) {
        const total = office + remote;
        if (!validCount(office) || !validCount(remote) || !validCount(total)) {
            throw new Error('Invalid storage counts received.');
        }
        const officePct = total ? office / total * 100 : 0;
        const remotePct = total ? remote / total * 100 : 0;
        el.officePercentage.textContent = total ? `${percent.format(officePct)}%` : '—';
        el.remotePercentage.textContent = total ? `${percent.format(remotePct)}%` : '—';
        el.officeCount.textContent = `${number.format(office)} ${office === 1 ? 'file' : 'files'}`;
        el.remoteCount.textContent = `${number.format(remote)} ${remote === 1 ? 'file' : 'files'}`;
        el.officeSegment.style.width = `${officePct}%`;
        el.remoteSegment.style.width = `${remotePct}%`;
        el.storageSummary.textContent = (total ? `${number.format(total)} ${total === 1 ? 'file' : 'files'} in total` : 'No files recorded') + suffix;
    }

    function cancel() {
        requestVersion++;
        controller?.abort();
        controller = null;
    }

    // ========================================
    // SUPABASE STORAGE COUNTS
    // ========================================

    async function refresh() {
        if (!authorized() || document.visibilityState === 'hidden') return;
        cancel();
        const version = requestVersion;
        const sb = window.supabaseClient;
        clear('Loading storage statistics…');
        if (!sb) {
            clear('Storage connection unavailable');
            console.error('[METROFILE] Supabase client is not initialized.');
            return;
        }
        const current = new AbortController();
        controller = current;
        const timer = setTimeout(() => current.abort(), 15000);
        try {
            const countAt = location => sb.from(TABLE)
                .select('id', { count: 'exact', head: true })
                .eq('storage_location', location)
                .abortSignal(current.signal);

            const [office, remote] = await Promise.all([
                countAt('van_rhyns'),
                countAt('metrofile')
            ]);
            if (version !== requestVersion || !authorized()) return;
            if (office.error) throw office.error;
            if (remote.error) throw remote.error;
            render(office.count, remote.count);
        } catch (error) {
            if (version !== requestVersion || !authorized()) return;
            clear('Unable to load storage statistics. Refresh to retry.');
            console.error('[METROFILE] Count query failed:', error?.code || '', error?.message || 'Unknown error');
        } finally {
            clearTimeout(timer);
            if (controller === current) controller = null;
        }
    }

    // ========================================
    // AUTHORIZATION & INITIALIZATION
    // ========================================

    new MutationObserver(() => {
        if (authorized()) refresh();
        else {
            cancel();
            clear('Waiting for authorization…');
        }
    }).observe(root, { attributes: true, attributeFilter: ['data-authorized'] });

    window.MetroFileStorage = Object.freeze({ refresh });
    clear('Waiting for authorization…');
    if (authorized()) refresh();
})();
