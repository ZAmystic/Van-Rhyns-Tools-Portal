(() => {
    'use strict';

    // Replace nulls with real counts once the storage data source is available.
    // Do not put confidential file records or privileged credentials here.
    const initialCounts = { atVanRhyns: null, atMetroFile: null };
    const byId = id => document.getElementById(id);
    const format = new Intl.NumberFormat('en-ZA');

    function setCounts(atVanRhyns, atMetroFile) {
        const valid = [atVanRhyns, atMetroFile].every(
            count => Number.isSafeInteger(count) && count >= 0
        ) && Number.isSafeInteger(atVanRhyns + atMetroFile);
        const total = valid ? atVanRhyns + atMetroFile : 0;
        // No location percentages exist when there are no files.
        const officePct = total ? Math.round(atVanRhyns / total * 100) : 0;
        const remotePct = total ? 100 - officePct : 0;

        byId('officePercentage').textContent = total ? `${officePct}%` : '—';
        byId('remotePercentage').textContent = total ? `${remotePct}%` : '—';
        byId('officeCount').textContent = valid ? `${format.format(atVanRhyns)} files` : '— files';
        byId('remoteCount').textContent = valid ? `${format.format(atMetroFile)} files` : '— files';
        byId('officeSegment').style.width = `${total ? atVanRhyns / total * 100 : 0}%`;
        byId('remoteSegment').style.width = `${total ? atMetroFile / total * 100 : 0}%`;
        byId('storageSummary').textContent = !valid ? 'Storage data not connected' : total ? `${format.format(total)} files in total` : 'No files recorded';
    }

    // Future authorized data fetching can call this function with aggregate counts.
    window.MetroFileStorage = Object.freeze({ setCounts });
    setCounts(initialCounts.atVanRhyns, initialCounts.atMetroFile);
})();
