(async () => {
    'use strict';
    // Shared application configuration. Resolve relative to this script,
    // not the current page, so nested tools and GitHub subpaths work.
    let MODE, CONFIG;
    try {
        const scriptUrl = document.currentScript?.src;
        const configUrl = scriptUrl
            ? new URL('../../assets/Config/environment.json', scriptUrl)
            : new URL('../../assets/Config/environment.json', document.baseURI);
        const response = await fetch(configUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Configuration HTTP ${response.status}`);
        const settings = await response.json();
        MODE = settings.mode;
        if (!['demo', 'production'].includes(MODE)) throw new Error('Invalid environment mode.');
        CONFIG = settings.environments?.[MODE];
        if (!CONFIG || !['filesTable', 'binsTable', 'auditTable', 'binsAuditTable'].every(key =>
            typeof CONFIG[key] === 'string' && CONFIG[key].length > 0) ||
            typeof CONFIG.showEnvironmentLabel !== 'boolean' ||
            typeof CONFIG.environmentLabel !== 'string') {
            throw new Error('Incomplete MetroFile environment settings.');
        }
    } catch (error) {
        console.error('[METROFILE] Configuration could not load:', error.message);
        const message = `Environment configuration unavailable (${error.message}). Check assets/Config/environment.json and reload.`;
        const notice = document.getElementById('appMessage');
        if (notice) { notice.textContent = message; notice.classList.add('error'); notice.hidden = false; }
        const list = document.getElementById('listMessage');
        if (list) { list.textContent = message; list.hidden = false; }
        for (const id of ['createBin', 'createFile', 'refresh', 'filesTab', 'binsTab', 'prevPage', 'nextPage']) {
            const element = document.getElementById(id);
            if (element) element.disabled = true;
        }
        return; // Never silently fall back to another database environment.
    }

    const PAGE_SIZE = 25, BOX_PAGE_SIZE = 5, AUDIT_PAGE_SIZE = 20;
    const SEARCH_DELAY = 250;
    const root = document.documentElement;
    const $ = id => document.getElementById(id);
    const format = new Intl.NumberFormat('en-ZA');
    const dateFormat = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });
    const locName = value => ({ van_rhyns: 'Van Rhyns', metrofile: 'MetroFile', mixed: 'Mixed locations', empty: 'Empty / available' })[value] || '—';
    const storageBoxLabel = (location, boxNumber, binId) => boxNumber || (binId ? '—' : location === 'van_rhyns' ? 'Van Rhyns Storage' : 'Unassigned');
    const date = value => value && !isNaN(Date.parse(value)) ? dateFormat.format(new Date(value)) : '—';
    const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
    const fullName = row => [row.client_surname, row.client_first_name].filter(Boolean).join(', ') || '—';
    const node = (tag, className, value) => { const e = document.createElement(tag); if (className) e.className = className; if (value !== undefined) e.textContent = text(value); return e; };
    const button = (label, handler, style = 'secondary') => { const e = node('button', `button button-${style}`, label); e.type = 'button'; e.addEventListener('click', handler); return e; };
    const state = { tab: 'files', page: 1, bin: null, search: '', location: 'all', total: 0, rows: [], listToken: 0, statsToken: 0, detailToken: 0, started: false, saving: false, searchTimer: null };
    const dialog = $('recordDialog');
    const allowed = () => root.hasAttribute('data-authorized');
    const sb = () => { if (!allowed() || !window.supabaseClient) throw new Error('Please sign in to continue.'); return window.supabaseClient; };
    const unwrap = result => { if (result.error) throw result.error; return result.data; };
    async function rpc(name, params = {}) { return unwrap(await sb().rpc(name, { p_mode: MODE, ...params })); }
    function errorText(error) {
        if (error?.code === '23505') return 'That reference or box number already exists.';
        if (error?.code === '42501') return 'You do not have permission to perform this action. Contact your administrator.';
        if (error?.code === '40001') return 'This record was changed by another employee. Close the details, refresh, and try again.';
        if (error?.code === '22023') return error.message || 'Please check your selection.';
        if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) return 'The storage database setup is incomplete. Ask your administrator to run the MetroFile SQL migration.';
        return 'Unable to complete the request. Check your connection and try again.';
    }
    function report(error) { console.error('[METROFILE]', error?.code || error?.name || 'request failed'); return errorText(error); }
    function notice(message = '', isError = false) { const el = $('appMessage'); el.textContent = message; el.classList.toggle('error', isError); el.hidden = !message; }
    function labelState(value) { const cls = value === 'van_rhyns' ? 'office' : value === 'metrofile' ? 'remote' : value === 'mixed' ? 'mixed' : ''; return node('span', `state ${cls}`, locName(value)); }
    function binLocation(row) { return row.storage_location; }
    function updateFilters() {
        $('filesTab').setAttribute('aria-pressed', String(state.tab === 'files'));
        $('binsTab').setAttribute('aria-pressed', String(state.tab === 'bins'));
        $('search').placeholder = state.tab === 'files' ? 'Search reference, surname or box…' : 'Search box number…';
        $('search').value = state.search; $('location').value = state.location;
        $('binFilter').hidden = !(state.tab === 'files' && state.bin);
        $('binFilterText').textContent = state.bin ? `Box: ${state.bin.box_number}` : '';
        document.querySelectorAll('.stat[data-location]').forEach(e => e.classList.toggle('active', state.tab === 'files' && state.location === e.dataset.location));
        $('showBinsStat').classList.toggle('active', state.tab === 'bins');
    }
    function selectTab(tab, location = 'all', bin = null) { clearTimeout(state.searchTimer); state.tab = tab; state.page = 1; state.search = ''; state.location = location; state.bin = bin; updateFilters(); loadList(); }
    function pagination() {
        const { total, page } = state;
        $('pageSummary').textContent = total ? `${format.format((page - 1) * PAGE_SIZE + 1)}–${format.format(Math.min(total, page * PAGE_SIZE))} of ${format.format(total)} ${state.tab === 'files' ? 'files' : 'bins'}` : `0 ${state.tab === 'files' ? 'files' : 'bins'}`;
        $('prevPage').disabled = page <= 1; $('nextPage').disabled = page * PAGE_SIZE >= total;
    }
    function listMessage(message) { $('listMessage').textContent = message; $('listMessage').hidden = !message; $('tableWrap').hidden = !!message; }
    async function loadStats() {
        const token = ++state.statsToken;
        try {
            const data = await rpc('metrofile_stats'); if (token !== state.statsToken || !allowed()) return;
            for (const [id, key] of [['totalFiles', 'total'], ['officeFiles', 'office'], ['remoteFiles', 'remote'], ['totalBins', 'bins']]) $(id).textContent = format.format(Number(data[key]));
            $('officePct').textContent = data.total ? `${format.format(Math.round(data.office / data.total * 1000) / 10)}% of files` : 'No files recorded';
            $('remotePct').textContent = data.total ? `${format.format(Math.round(data.remote / data.total * 1000) / 10)}% of files` : 'No files recorded';
            $('unassignedFiles').textContent = `${format.format(Number(data.unassigned))} unassigned ${Number(data.unassigned) === 1 ? 'file' : 'files'}`;
        } catch (error) { if (token !== state.statsToken || !allowed()) return; for (const id of ['totalFiles', 'officeFiles', 'remoteFiles', 'totalBins', 'officePct', 'remotePct', 'unassignedFiles']) $(id).textContent = '—'; notice(report(error), true); }
    }
    async function loadList() {
        if (!allowed()) return;
        const token = ++state.listToken, tab = state.tab;
        $('tableBody').replaceChildren(); listMessage('Loading storage records…'); $('prevPage').disabled = true; $('nextPage').disabled = true; $('pageSummary').textContent = 'Loading…';
        try {
            const params = { p_search: state.search, p_location: state.location, p_page: state.page, p_page_size: PAGE_SIZE };
            if (tab === 'files') params.p_bin = state.bin?.id || null;
            const data = await rpc(tab === 'files' ? 'metrofile_search_files' : 'metrofile_search_bins', params);
            if (token !== state.listToken || !allowed()) return;
            state.total = Number(data.total); state.rows = data.rows || [];
            const last = Math.max(1, Math.ceil(state.total / PAGE_SIZE)); if (state.page > last) { state.page = last; return loadList(); }
            renderTable(); pagination();
            if (!state.rows.length) listMessage(state.search || state.location !== 'all' || state.bin ? 'No matching records. Try another search or clear the filters.' : tab === 'files' ? 'No files yet. Select Add file to get started.' : 'No bins yet. Select New bin to get started.');
        } catch (error) { if (token !== state.listToken || !allowed()) return; state.rows = []; state.total = 0; $('pageSummary').textContent = 'Unavailable'; listMessage(report(error)); }
    }
    function renderTable() {
        const files = state.tab === 'files';
        const columns = files ? ['Van Rhyns ID', 'SARS ID', 'Client', 'Box number', 'Location', ''] : ['Box number', 'Location', 'Files', ''];
        const tr = node('tr'); columns.forEach(c => { const th = node('th', c ? '' : 'action-cell', c || 'Action'); th.scope = 'col'; tr.append(th); }); $('tableHead').replaceChildren(tr);
        const fragment = document.createDocumentFragment();
        for (const item of state.rows) {
            const row = node('tr'); row.dataset.clickable = '';
            const action = () => files ? openFile(item.id) : openBin(item.id);
            const name = node('button', 'file-link', files ? item.van_rhyns_id : item.box_number); name.type = 'button'; name.addEventListener('click', action);
            function cell(v, cls = '') { const td = node('td', cls); td.append(v instanceof Node ? v : document.createTextNode(text(v))); row.append(td); }
            cell(name);
            if (files) { cell(item.sars_id, 'sars-id'); cell(fullName(item)); cell(storageBoxLabel(item.storage_location, item.box_number, item.bin_id)); cell(labelState(item.storage_location)); }
            else { cell(labelState(binLocation(item))); cell(format.format(Number(item.file_count))); }
            const actions = node('div', 'table-actions'); actions.append(button(files ? 'View file' : 'View bin', action)); if (!files && item.storage_location === 'van_rhyns') actions.append(button('Send to MetroFile', () => openDispatch(item), 'primary')); cell(actions, 'action-cell');
            row.addEventListener('click', e => { if (!e.target.closest('button,a')) action(); }); fragment.append(row);
        }
        $('tableBody').replaceChildren(fragment); listMessage('');
    }
    function refreshAll() { notice(); loadStats(); loadList(); }
    function openDialog(title, form = false) { if (!allowed()) return false; dialog.classList.toggle('form-dialog', form); $('dialogTitle').textContent = title; $('dialogBody').replaceChildren(); if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0; return true; }
    function closeDialog() { if (state.saving) return; state.detailToken++; if (dialog.open) dialog.close(); }
    $('closeDialog').addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(); } });
    function detailField(container, label, value, wide = false) { const wrap = node('div', wide ? 'wide' : ''); wrap.append(node('dt', '', label), node('dd', label === 'SARS ID' ? 'sars-id' : '', value)); container.append(wrap); }
    async function openFile(id, successMessage = '') {
        const token = ++state.detailToken; if (!openDialog('File details')) return;
        $('dialogBody').append(node('p', 'muted', 'Loading file information…'));
        try {
            const file = unwrap(await sb().from(CONFIG.filesTable).select(`*,bin:${CONFIG.binsTable}!bin_id(box_number,storage_location),previousBin:${CONFIG.binsTable}!previous_metrofile_bin_id(box_number,storage_location)`).eq('id', id).single());
            if (token !== state.detailToken || !allowed() || !dialog.open) return;
            renderDetails(file, token, successMessage);
        } catch (error) { if (token === state.detailToken && dialog.open && allowed()) $('dialogBody').replaceChildren(node('p', 'form-error', report(error))); }
    }
    const canReturnFile = file => file.storage_location === 'van_rhyns' && !file.bin_id && !!file.previous_metrofile_bin_id && file.previousBin?.storage_location === 'metrofile';
    const canChangeBox = file => file.storage_location === 'van_rhyns' && !!file.bin_id && !file.previous_metrofile_bin_id && file.bin?.storage_location === 'van_rhyns';
    function renderDetails(file, token, successMessage = '') {
        $('dialogTitle').textContent = file.van_rhyns_id;
        const body = $('dialogBody'); body.replaceChildren();
        const top = node('div', 'detail-top'); const info = node('div'); info.append(node('h3', '', fullName(file)), labelState(file.storage_location));
        const actions = node('div', 'detail-actions');
        actions.append(button('Edit file', () => openEditFile(file)));
        if (file.storage_location === 'metrofile') actions.append(button('Retrieve from MetroFile', () => openMovement(file, 'retrieve'), 'primary'));
        else if (canReturnFile(file)) actions.append(button('Return to MetroFile', () => openMovement(file, 'return'), 'primary'));
        if (canChangeBox(file)) actions.append(button('Assign / change box', () => openMovement(file, 'assign')));
        top.append(info, actions); body.append(top);
        if (successMessage) { const success = node('p', 'notice edit-success', successMessage); success.setAttribute('role', 'status'); body.append(success); }
        if (canChangeBox(file)) body.append(node('p', 'bin-rule', 'This file is packed in a Van Rhyns bin. You can change its box until the first dispatch to MetroFile.'));
        else if (file.storage_location === 'metrofile') body.append(node('p', 'bin-rule', 'This file has a permanent MetroFile box. It can be retrieved, but its box assignment cannot be changed.'));
        else if (canReturnFile(file)) body.append(node('p', 'bin-rule', `Return this file to its original MetroFile box: ${file.previousBin.box_number}.`));
        else body.append(node('p', 'bin-rule', 'No eligible storage movement is available for this record. Contact your administrator to verify the box assignment.'));
        const dl = node('dl', 'detail-grid');
        for (const [label, value] of [['Van Rhyns ID', file.van_rhyns_id], ['SARS ID', file.sars_id], ['Client surname', file.client_surname], ['Client first name', file.client_first_name], ['Storage location', locName(file.storage_location)], ['Box number', storageBoxLabel(file.storage_location, file.bin?.box_number, file.bin_id)], ['Previous MetroFile box', file.previousBin?.box_number || 'Not recorded'], ['Database ID', file.id], ['Created', date(file.created_at)], ['Last updated', date(file.updated_at)], ['Created by (user ID)', file.created_by || 'Not recorded'], ['Updated by (user ID)', file.updated_by || 'Not recorded']]) detailField(dl, label, value);
        detailField(dl, 'Notes', file.notes || 'No notes recorded', true); body.append(dl);
        const heading = node('div', 'section-heading'); heading.append(node('h3', '', 'Audit log'), node('span', 'muted', 'South Africa time')); body.append(heading);
        const history = node('ol', 'timeline'); const more = node('div', 'audit-more'); body.append(history, more);
        loadAudit(file.id, token, history, more, null);
    }
    const eventNames = { existing_record: 'Existing record imported', created: 'File created', retrieved: 'Retrieved from MetroFile', returned: 'Returned to MetroFile', bin_changed: 'Box assignment changed', updated: 'File information updated', bin_dispatched: 'Sent to MetroFile with bin', dispatched: 'Bin sent to MetroFile' };
    function eventItem(event) {
        const li = node('li'); const head = node('div', 'event-title'); head.append(node('strong', '', eventNames[event.event_type] || event.event_type), node('time', '', date(event.occurred_at))); li.append(head);
        const actor = event.actor_name || (event.actor_id ? `Employee ${event.actor_id}` : event.event_type === 'existing_record' ? 'System baseline' : 'Administrator / system'); li.append(node('p', 'muted', `By ${actor}`));
        if (event.event_type === 'existing_record') { li.append(node('p', 'muted', 'Record existed before audit history was enabled. Earlier movements are not available.')); return li; }
        const before = event.old_record || {}, after = event.new_record || {};
        const changes = node('ul', 'event-changes');
        const fields = { van_rhyns_id: 'Van Rhyns ID', sars_id: 'SARS ID', client_surname: 'Surname', client_first_name: 'First name', storage_location: 'Location', bin_id: 'Box', file_status: 'Status', notes: 'Notes' };
        for (const [key, label] of Object.entries(fields)) if (event.old_record && before[key] !== after[key]) {
            const formatValue = (r) => key === 'storage_location' ? locName(r[key]) : key === 'bin_id' ? storageBoxLabel(r.storage_location, r.box_number || r[key], r[key]) : text(r[key]);
            changes.append(node('li', '', `${label}: ${formatValue(before)} → ${formatValue(after)}`));
        }
        if (event.event_type === 'created') li.append(node('p', '', `Created at ${locName(after.storage_location)} · ${storageBoxLabel(after.storage_location, after.box_number || after.bin_id, after.bin_id)}`));
        if (changes.childNodes.length) li.append(changes);
        if (event.reason) li.append(node('p', 'event-reason', `Reason: ${event.reason}`));
        else if (event.event_type === 'returned') li.append(node('p', 'muted', 'No return reason supplied.'));
        return li;
    }
    async function loadAudit(fileId, token, history, more, beforeId) {
        more.replaceChildren(node('p', 'muted', 'Loading audit history…'));
        try {
            let query = sb().from(CONFIG.auditTable).select('id,event_type,occurred_at,actor_id,actor_name,reason,old_record,new_record').eq('file_id', fileId).order('id', { ascending: false }).limit(AUDIT_PAGE_SIZE + 1);
            if (beforeId !== null) query = query.lt('id', beforeId);
            const rows = unwrap(await query);
            if (token !== state.detailToken || !allowed() || !dialog.open) return;
            more.replaceChildren(); const page = rows.slice(0, AUDIT_PAGE_SIZE); for (const row of page) history.append(eventItem(row));
            if (!history.childNodes.length) more.append(node('p', 'empty-history', 'No audit records available.'));
            else if (rows.length > AUDIT_PAGE_SIZE) more.append(button('Load earlier events', () => loadAudit(fileId, token, history, more, page[page.length - 1].id)));
        } catch (error) { if (token === state.detailToken && allowed() && dialog.open) { more.replaceChildren(node('p', 'form-error', report(error)), button('Retry audit history', () => loadAudit(fileId, token, history, more, beforeId))); } }
    }
    function inputField(label, name, opts = {}) {
        const field = node('label', 'field'); const title = node('span', '', label + (opts.required ? ' *' : '')); let input;
        if (opts.type === 'textarea') { input = node('textarea'); input.rows = 3; } else if (opts.options) { input = node('select'); for (const [value, caption] of opts.options) { const option = node('option', '', caption); option.value = value; input.append(option); } } else { input = node('input'); input.type = opts.type || 'text'; }
        input.name = name; input.required = !!opts.required; if (opts.max) input.maxLength = opts.max; if (opts.placeholder) input.placeholder = opts.placeholder; if (opts.value !== undefined) input.value = opts.value;
        field.append(title, input); if (opts.help) field.append(node('small', '', opts.help)); return { field, input };
    }
    // Single searchable box field: server-side literal substring search, five results at a time.
    function createPicker(form, location, selected = null) {
        const wrap = node('div', 'picker field');
        const fieldTitle = node('label', '', 'Destination box *'); fieldTitle.htmlFor = 'destinationBox';
        const search = node('input'); search.type = 'search'; search.id = 'destinationBox'; search.placeholder = 'Search box number…'; search.maxLength = 100; search.autocomplete = 'off'; search.required = true;
        search.setAttribute('aria-controls', 'destinationBoxResults'); search.setAttribute('aria-describedby', 'destinationBoxHint destinationBoxSummary');
        const results = node('div', 'picker-results'); results.id = 'destinationBoxResults'; results.setAttribute('role', 'group'); results.setAttribute('aria-label', 'Matching boxes');
        const summary = node('small', 'picker-summary', 'Loading boxes…'); summary.id = 'destinationBoxSummary'; summary.setAttribute('aria-live', 'polite');
        const nav = node('div', 'picker-nav'); const previous = button('Previous', () => { page--; load(); }), next = button('Next', () => { page++; load(); }); nav.append(previous, summary, next); nav.hidden = true;
        const eligibility = node('small', '', ''); eligibility.id = 'destinationBoxHint';
        wrap.append(fieldTitle, search, results, nav, eligibility);
        let loc = location, page = 1, request = 0, chosen = selected, timer = null, loading = false;
        function explain() { eligibility.textContent = `Select a box physically located at ${locName(loc)}.`; }
        function validate() { search.setCustomValidity(chosen ? '' : 'Select a box from the search results.'); }
        function choose(row) { chosen = { id: row.id, box_number: row.box_number }; search.value = row.box_number; validate(); results.replaceChildren(); results.hidden = true; nav.hidden = false; previous.hidden = next.hidden = true; summary.textContent = `Selected: ${row.box_number}`; }
        if (chosen) { search.value = chosen.box_number; }
        explain(); validate();
        async function load() {
            clearTimeout(timer); const version = ++request; loading = true; results.hidden = false; results.replaceChildren(); nav.hidden = false; previous.hidden = next.hidden = false; previous.disabled = next.disabled = true; summary.textContent = 'Loading boxes…';
            try {
                const data = await rpc('metrofile_search_bins', { p_search: search.value.trim(), p_location: `available_${loc}`, p_page: page, p_page_size: BOX_PAGE_SIZE });
                if (version !== request || !wrap.isConnected || !allowed()) return;
                const rows = data.rows || [], total = Number(data.total); results.replaceChildren();
                for (const row of rows) { const option = node('button', 'button button-picker-option picker-result'); option.type = 'button'; option.addEventListener('click', () => choose(row)); option.setAttribute('aria-pressed', String(chosen?.id === row.id)); option.append(node('strong', '', row.box_number), node('span', 'muted', `${format.format(Number(row.file_count))} files`)); results.append(option); }
                if (!rows.length) results.append(node('p', 'picker-empty', 'No matching boxes at this location.'));
                summary.textContent = total ? `${(page - 1) * BOX_PAGE_SIZE + 1}–${Math.min(page * BOX_PAGE_SIZE, total)} of ${total} boxes` : '0 boxes';
                previous.hidden = next.hidden = total <= BOX_PAGE_SIZE; previous.disabled = page <= 1; next.disabled = page * BOX_PAGE_SIZE >= total;
            } catch (error) { if (version !== request || !wrap.isConnected || !allowed()) return; chosen = null; validate(); summary.textContent = report(error); results.replaceChildren(); previous.hidden = next.hidden = true; }
            finally { if (version === request) loading = false; }
        }
        search.addEventListener('input', () => { clearTimeout(timer); request++; loading = true; chosen = null; validate(); page = 1; results.hidden = false; results.replaceChildren(); nav.hidden = false; previous.hidden = next.hidden = true; summary.textContent = 'Searching…'; timer = setTimeout(load, SEARCH_DELAY); });
        search.addEventListener('focus', () => { if (results.hidden && !loading) load(); });
        search.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { const first = results.querySelector('button'); if (first) { event.preventDefault(); first.focus(); } } if (event.key === 'Enter') { event.preventDefault(); const options = results.querySelectorAll('button'); if (!chosen && options.length === 1) options[0].click(); } });
        results.addEventListener('keydown', event => { if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; const buttons = Array.from(results.querySelectorAll('button')); const index = buttons.indexOf(document.activeElement); if (index < 0) return; event.preventDefault(); const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1); if (nextIndex < 0) search.focus(); else buttons[Math.min(nextIndex, buttons.length - 1)]?.focus(); });
        return { wrap, get value() { return loading ? null : chosen?.id || null; }, load, setLocation(value) { loc = value; explain(); page = 1; chosen = null; search.value = ''; validate(); load(); } };
    }
    function setupForm(form, submitLabel, onSubmit, onCancel) {
        const error = node('p', 'form-error'); error.hidden = true; error.setAttribute('role', 'alert'); const actions = node('div', 'form-actions'); const cancel = button('Cancel', onCancel || closeDialog); const submit = node('button', 'button button-primary', submitLabel); submit.type = 'submit'; actions.append(cancel, submit); form.append(error, actions);
        form.addEventListener('submit', async event => {
            event.preventDefault(); if (state.saving || !allowed()) return; if (!form.reportValidity()) return; error.hidden = true; state.saving = true; submit.disabled = true; cancel.disabled = true; $('closeDialog').disabled = true; submit.textContent = 'Saving…';
            try { await onSubmit(); } catch (err) { if (form.isConnected && allowed()) { error.textContent = report(err); error.hidden = false; } } finally { state.saving = false; submit.disabled = false; cancel.disabled = false; $('closeDialog').disabled = false; submit.textContent = submitLabel; }
        });
        return error;
    }
    const invalid = message => Object.assign(new Error(message), { code: '22023' });
    function done(message, fileId = null) { if (!allowed()) return; state.detailToken++; if (dialog.open) dialog.close(); refreshAll(); notice(message); if (fileId) openFile(fileId); }
    function openNewBin() { state.detailToken++; if (!openDialog('Create a storage bin', true)) return; const body = $('dialogBody'); body.append(node('p', 'form-intro', 'New bins always start at Van Rhyns. Add files, then send the entire bin to MetroFile when ready.')); const form = node('form', 'record-form'); const box = inputField('Box number', 'box_number', { required: true, max: 80, placeholder: 'e.g. BOX-06' }); box.input.classList.add('uppercase-box'); box.input.addEventListener('input', () => { const start = box.input.selectionStart, end = box.input.selectionEnd; box.input.value = box.input.value.toUpperCase(); box.input.setSelectionRange(start, end); }); form.append(box.field); setupForm(form, 'Create bin', async () => { const value = box.input.value.trim().toUpperCase(); if (!value) throw invalid('Enter a box number.'); unwrap(await sb().from(CONFIG.binsTable).insert({ box_number: value })); done(`Box ${value} created.`); }); body.append(form); box.input.focus(); }
    function openNewFile() {
        state.detailToken++; if (!openDialog('Add a storage file', true)) return; const body = $('dialogBody'); body.append(node('p', 'form-intro', 'Enter the file reference and client details, then select a local box. New files start at Van Rhyns.')); const form = node('form', 'record-form'), grid = node('div', 'form-grid');
        for (const [label, name, required] of [['Van Rhyns ID', 'van_rhyns_id', true], ['SARS ID', 'sars_id', false], ['Client surname', 'client_surname', true], ['Client first name', 'client_first_name', false]]) grid.append(inputField(label, name, { required, max: 150 }).field);
        const location = inputField('Storage location', 'storage_location', { required: true, options: [['van_rhyns', 'Van Rhyns']] });
        const picker = createPicker(form, location.input.value); location.input.addEventListener('change', () => picker.setLocation(location.input.value));
        form.append(grid, location.field, picker.wrap, inputField('Notes', 'notes', { type: 'textarea', max: 3000, placeholder: 'Additional information (optional)' }).field);
        setupForm(form, 'Add file', async () => {
            const data = new FormData(form); const trim = key => String(data.get(key) || '').trim(); const bin = picker.value; if (!bin) throw invalid('Select an eligible destination box.'); if (!trim('van_rhyns_id') || !trim('client_surname')) throw invalid('Van Rhyns ID and surname are required.');
            const row = unwrap(await sb().from(CONFIG.filesTable).insert({ van_rhyns_id: trim('van_rhyns_id'), sars_id: trim('sars_id') || null, client_surname: trim('client_surname'), client_first_name: trim('client_first_name') || null, storage_location: trim('storage_location'), bin_id: bin, notes: trim('notes') || null }).select('id').single()); done('File added successfully.', row.id);
        }); body.append(form); picker.load(); form.querySelector('input').focus();
    }
    // Edit descriptive fields only. Physical movement remains controlled by the movement RPC.
    function openEditFile(file) {
        state.detailToken++;
        if (!openDialog('Edit file information', true)) return;
        const body = $('dialogBody');
        const summary = node('div', 'move-summary edit-context');
        summary.append(node('strong', '', file.van_rhyns_id), labelState(file.storage_location), node('span', 'muted', storageBoxLabel(file.storage_location, file.bin?.box_number, file.bin_id)));
        body.append(summary, node('p', 'form-intro', 'Update the reference or client details below. Changes are recorded in the file audit log.'));
        const form = node('form', 'record-form'), grid = node('div', 'form-grid');
        const specs = [['Van Rhyns ID', 'van_rhyns_id', true], ['SARS ID', 'sars_id', false], ['Client surname', 'client_surname', true], ['Client first name', 'client_first_name', false]];
        for (const [label, name, required] of specs) {
            const field = inputField(label, name, { required, max: 150, value: file[name] ?? '' });
            if (name === 'sars_id') field.input.classList.add('sars-id');
            grid.append(field.field);
        }
        form.append(grid, inputField('Notes', 'notes', { type: 'textarea', max: 3000, value: file.notes ?? '', placeholder: 'Additional information (optional)' }).field);
        const hint = node('p', 'edit-hint', 'To change a box or storage location, use the existing file movement actions.');
        form.append(hint);
        setupForm(form, 'Save changes', async () => {
            const data = new FormData(form), trim = key => String(data.get(key) ?? '').trim();
            const payload = { van_rhyns_id: trim('van_rhyns_id'), sars_id: trim('sars_id') || null, client_surname: trim('client_surname'), client_first_name: trim('client_first_name') || null, notes: trim('notes') || null };
            if (!payload.van_rhyns_id || !payload.client_surname) throw invalid('Van Rhyns ID and surname are required.');
            // Avoid rewriting unchanged values (including legacy whitespace).
            const changes = Object.fromEntries(Object.entries(payload).filter(([key, value]) => value !== (String(file[key] ?? '').trim() || null)));
            if (!Object.keys(changes).length) { await openFile(file.id, 'No changes to save.'); return; }
            if (!file.updated_at) throw invalid('Cannot verify the record version. Reopen the file and try again.');
            // Compare the original timestamp to avoid overwriting a concurrent update.
            const rows = unwrap(await sb().from(CONFIG.filesTable).update(changes).eq('id', file.id).eq('updated_at', file.updated_at).select('id'));
            if (!Array.isArray(rows) || rows.length !== 1) throw Object.assign(new Error('File changed or access is no longer available.'), { code: '40001' });
            if (!allowed()) return;
            refreshAll();
            await openFile(file.id, 'File information saved successfully.');
        }, () => openFile(file.id));
        body.append(form); form.querySelector('input')?.focus();
    }
    async function openBin(id) {
        const token = ++state.detailToken; if (!openDialog('Bin details')) return;
        const body = $('dialogBody'); body.append(node('p', 'muted', 'Loading bin details…'));
        try {
            const result = await Promise.all([
                sb().from(CONFIG.binsTable).select('*').eq('id', id).single(),
                sb().from(CONFIG.filesTable).select('id', { count: 'exact', head: true }).eq('bin_id', id)
            ]);
            const bin = unwrap(result[0]); if (result[1].error) throw result[1].error;
            if (token !== state.detailToken || !allowed() || !dialog.open) return;
            bin.file_count = result[1].count;
            $('dialogTitle').textContent = bin.box_number; body.replaceChildren();
            const top = node('div', 'detail-top'), info = node('div'), actions = node('div', 'detail-actions'); info.append(node('h3', '', `${format.format(bin.file_count)} files`), labelState(bin.storage_location));
            actions.append(button('View files', () => { closeDialog(); selectTab('files', 'all', { id: bin.id, box_number: bin.box_number }); }));
            if (bin.storage_location === 'van_rhyns') actions.append(button('Send to MetroFile', () => openDispatch(bin), 'primary'));
            top.append(info, actions); body.append(top);
            const dl = node('dl', 'detail-grid'); for (const [label, value] of [['Box number', bin.box_number], ['Location', locName(bin.storage_location)], ['Created', date(bin.created_at)], ['Sent to MetroFile', date(bin.sent_to_metrofile_at)], ['Dispatched by', bin.sent_to_metrofile_by || 'Not recorded']]) detailField(dl, label, value); body.append(dl);
            if (bin.storage_location === 'metrofile') body.append(node('p', 'bin-rule', 'This bin remains at MetroFile permanently. Only individual files can be retrieved.'));
            const heading = node('div', 'section-heading'); heading.append(node('h3', '', 'Bin audit log'), node('span', 'muted', 'South Africa time')); body.append(heading);
            const history = node('ol', 'timeline'), more = node('div', 'audit-more'); body.append(history, more); loadBinAudit(id, token, history, more, null);
        } catch (error) { if (token === state.detailToken && dialog.open && allowed()) body.replaceChildren(node('p', 'form-error', report(error))); }
    }
    async function loadBinAudit(id, token, history, more, before) {
        more.replaceChildren(node('p', 'muted', 'Loading audit history…'));
        try {
            let query = sb().from(CONFIG.binsAuditTable).select('id,event_type,occurred_at,actor_id,actor_name,reason,old_record,new_record').eq('bin_id', id).order('id', { ascending: false }).limit(AUDIT_PAGE_SIZE + 1); if (before !== null) query = query.lt('id', before);
            const rows = unwrap(await query); if (token !== state.detailToken || !dialog.open || !allowed()) return; more.replaceChildren();
            const page = rows.slice(0, AUDIT_PAGE_SIZE); for (const row of page) { const li = node('li'), head = node('div', 'event-title'); head.append(node('strong', '', ({ existing_record: 'Existing bin recorded', created: 'Bin created', dispatched: 'Bin sent to MetroFile', updated: 'Bin updated' })[row.event_type] || row.event_type), node('time', '', date(row.occurred_at))); li.append(head, node('p', 'muted', `By ${row.actor_name || row.actor_id || 'Administrator / system'}`)); if (row.event_type === 'existing_record') li.append(node('p', 'muted', 'Original dispatch details may not be known.')); if (row.old_record?.storage_location !== row.new_record?.storage_location && row.old_record) li.append(node('p', '', `${locName(row.old_record.storage_location)} → ${locName(row.new_record.storage_location)}`)); if (row.old_record && row.old_record.box_number !== row.new_record.box_number) li.append(node('p', '', `${row.old_record.box_number} → ${row.new_record.box_number}`)); if (row.reason) li.append(node('p', 'event-reason', `Notes: ${row.reason}`)); history.append(li); }
            if (!history.childNodes.length) more.append(node('p', 'empty-history', 'No bin audit records available.')); else if (rows.length > AUDIT_PAGE_SIZE) more.append(button('Load earlier events', () => loadBinAudit(id, token, history, more, page[page.length - 1].id)));
        } catch (error) { if (token === state.detailToken && dialog.open && allowed()) more.replaceChildren(node('p', 'form-error', report(error)), button('Retry audit history', () => loadBinAudit(id, token, history, more, before))); }
    }
    function openDispatch(bin) {
        state.detailToken++; if (!openDialog('Send bin to MetroFile', true)) return;
        const body = $('dialogBody'); const summary = node('div', 'move-summary'); summary.append(node('strong', '', bin.box_number), node('span', '', `${format.format(Number(bin.file_count))} files`), labelState('van_rhyns'), node('span', 'muted', '→ MetroFile')); body.append(summary, node('p', 'bin-rule', 'Permanent transfer: the bin and every file currently inside it will move to MetroFile. The bin cannot be brought back; only individual files can be retrieved.'));
        const form = node('form', 'record-form'); const notes = inputField('Dispatch notes (optional)', 'reason', { type: 'textarea', max: 1000 }); const confirmation = node('label', 'dispatch-confirm'); const check = node('input'); check.type = 'checkbox'; check.required = true; confirmation.append(check, node('span', '', 'I confirm that this physical bin and its contents are being sent to MetroFile.')); form.append(notes.field, confirmation);
        setupForm(form, 'Confirm transfer', async () => { if (!check.checked) throw invalid('Confirm the physical transfer first.'); const result = await rpc('metrofile_dispatch_bin', { p_bin_id: bin.id, p_expected_count: Number(bin.file_count), p_reason: notes.input.value.trim() || null }); done(`${bin.box_number} sent to MetroFile with ${result.files_moved} files.`); openBin(bin.id); }, () => openBin(bin.id)); body.append(form);
    }
    function openMovement(file, action) {
        if (action === 'return' && !canReturnFile(file)) { notice('This file has no eligible original MetroFile box.', true); return; }
        if (action === 'assign' && !canChangeBox(file)) { notice('Box changes are only available before the first bin dispatch.', true); return; }
        if (action === 'retrieve' && file.storage_location !== 'metrofile') { notice('Only files at MetroFile can be retrieved.', true); return; }
        state.detailToken++; const retrieve = action === 'retrieve', returning = action === 'return'; const target = retrieve ? 'van_rhyns' : returning ? 'metrofile' : file.storage_location;
        const title = retrieve ? 'Retrieve from MetroFile' : returning ? 'Return to MetroFile' : 'Assign / change box'; if (!openDialog(title, true)) return;
        const body = $('dialogBody'); body.append(node('p', 'form-intro', retrieve ? 'Confirm that the physical file has been received at Van Rhyns. A retrieval reason is mandatory.' : returning ? 'Confirm that the file has been returned to its original MetroFile box. A return reason is optional.' : 'Select a different local Van Rhyns box before dispatch.'));
        const summary = node('div', 'move-summary'); summary.append(node('strong', '', file.van_rhyns_id), labelState(file.storage_location), node('span', 'muted', `→ ${locName(target)}`)); body.append(summary);
        const form = node('form', 'record-form');
        const picker = (!retrieve && !returning) ? createPicker(form, 'van_rhyns') : null;
        if (picker) form.append(picker.wrap);
        if (returning) {
            const destination = inputField('Original MetroFile box', 'original_box', { value: file.previousBin.box_number, help: 'This permanent box assignment cannot be changed.' });
            destination.input.readOnly = true;
            form.append(destination.field);
        }
        const reason = inputField(retrieve ? 'Reason for retrieving' : returning ? 'Reason for returning (optional)' : 'Reason for box change (optional)', 'reason', { type: 'textarea', required: retrieve, max: 1000, placeholder: retrieve ? 'e.g. Client consultation or SARS review' : 'Enter a reason if applicable', help: retrieve ? 'This reason will be saved in the permanent audit history.' : 'If provided, this reason will be saved in the audit history.' }); form.append(reason.field);
        setupForm(form, retrieve ? 'Confirm retrieval' : returning ? 'Confirm return' : 'Save box assignment', async () => {
            const why = reason.input.value.trim(); if (retrieve && !why) throw invalid('A retrieval reason is required.'); const bin = retrieve ? null : returning ? file.previous_metrofile_bin_id : picker.value; if (!retrieve && !bin) throw invalid('Select a destination box.'); if (target === file.storage_location && bin === file.bin_id) throw invalid('Select a different box.');
            await rpc('metrofile_move', { p_file_id: file.id, p_expected_location: file.storage_location, p_expected_bin_id: file.bin_id || null, p_target_location: target, p_target_bin_id: bin, p_reason: why || null }); done(retrieve ? 'File retrieved and audit log updated.' : returning ? 'File returned and audit log updated.' : 'Box assignment updated.', file.id);
        }, () => openFile(file.id)); body.append(form); if (picker) picker.load(); else reason.input.focus();
    }
    $('filesTab').addEventListener('click', () => selectTab('files')); $('binsTab').addEventListener('click', () => selectTab('bins')); $('showBinsStat').addEventListener('click', () => selectTab('bins'));
    document.querySelectorAll('.stat[data-location]').forEach(e => e.addEventListener('click', () => selectTab('files', e.dataset.location)));
    $('search').addEventListener('input', () => { state.search = $('search').value; state.page = 1; state.listToken++; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(loadList, SEARCH_DELAY); });
    $('location').addEventListener('change', () => { state.location = $('location').value; state.page = 1; updateFilters(); loadList(); });
    $('clearFilters').addEventListener('click', () => selectTab(state.tab)); $('removeBinFilter').addEventListener('click', () => { state.bin = null; state.page = 1; updateFilters(); loadList(); });
    $('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; loadList(); } }); $('nextPage').addEventListener('click', () => { if (state.page * PAGE_SIZE < state.total) { state.page++; loadList(); } });
    $('refresh').addEventListener('click', refreshAll); $('createBin').addEventListener('click', openNewBin); $('createFile').addEventListener('click', openNewFile);
    $('year').textContent = new Date().getFullYear();
    if (!CONFIG) { notice('Invalid MetroFile environment configuration.', true); return; }
    $('environmentLabel').hidden = !CONFIG.showEnvironmentLabel; $('environmentLabel').textContent = CONFIG.environmentLabel;
    function authorizationChanged() { if (allowed()) { if (!state.started) { state.started = true; updateFilters(); refreshAll(); } } else { state.started = false; state.listToken++; state.statsToken++; state.detailToken++; clearTimeout(state.searchTimer); if (dialog.open) dialog.close(); $('dialogBody').replaceChildren(); $('tableBody').replaceChildren(); state.rows = []; state.total = 0; notice(); } }
    new MutationObserver(authorizationChanged).observe(root, { attributes: true, attributeFilter: ['data-authorized'] }); authorizationChanged();
})();
