const fs = require("node:fs");
const path = require("node:path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY;

// Validate environment variables
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing Supabase environment variables.");
}

// Prevent accidental use of secret keys
if (!SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
    throw new Error("A Supabase publishable key is required.");
}

// Prepare output directory
const output = path.resolve(__dirname, "../dist");
const root = path.resolve(__dirname, "..");

fs.rmSync(output, {
    recursive: true,
    force: true
});

fs.mkdirSync(output, {
    recursive: true
});

// Copy website assets
fs.cpSync(
    path.join(root, "assets"),
    path.join(output, "assets"),
    {
        recursive: true,
        filter: source => source !== path.join(
            root,
            "assets",
            "JavaScript",
            "config.js"
        )
    }
);

// Copy HTML pages
for (const file of fs.readdirSync(root)) {
    if (file.endsWith(".html")) {
        fs.copyFileSync(
            path.join(root, file),
            path.join(output, file)
        );
    }
}

// Generate environment configuration
const config = {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
};

fs.writeFileSync(
    path.join(output, "assets/JavaScript/config.js"),
    `window.APP_CONFIG = Object.freeze(${JSON.stringify(config)});`
);

console.log("Website build completed successfully.");