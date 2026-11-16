// ========================================
// DATABASE CONFIGURATION
// ========================================

if (!window.APP_CONFIG) {
    throw new Error("Application configuration is missing.");
}

const {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
} = window.APP_CONFIG;


// ========================================
// INITIALIZE SUPABASE
// ========================================

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
        }
    }
);

console.log("Supabase client initialized.");
