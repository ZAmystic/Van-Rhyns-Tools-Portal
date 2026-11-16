// Compatibility for existing HTML pages. database.js now contains the shared session logic.
if (!window.PortalAuth) console.error('[AUTH] Load the updated database.js before session.js.');
