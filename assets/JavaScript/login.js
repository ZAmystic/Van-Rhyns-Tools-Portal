const loginForm = document.querySelector(".login-form");
const loginError = document.getElementById("loginError");

if (!loginForm) {
    throw new Error("Login form not found.");
}

const loginButton = loginForm.querySelector(".login-button");

if (!loginButton) {
    throw new Error("Login button not found.");
}

const buttonText = loginButton.querySelector("span");

// ========================================
// ERROR HANDLING
// ========================================

function showError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
}

function clearError() {
    loginError.textContent = "";
    loginError.hidden = true;
}


// ========================================
// LOADING STATE
// ========================================

function setLoading(isLoading) {
    loginButton.disabled = isLoading;

    buttonText.textContent = isLoading
        ? "Signing in..."
        : "Sign in";
}


// ========================================
// VALIDATE EMPLOYEE PROFILE
// ========================================

async function validateProfile(userId) {

    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("id, first_name, last_name, role, is_active")
        .eq("id", userId)
        .single();

    if (error || !profile) {
        throw new Error(
            "Your employee profile could not be verified. Contact your administrator."
        );
    }

    if (!profile.is_active) {
        throw new Error(
            "Your account has been disabled. Contact your administrator."
        );
    }

    return profile;
}


// ========================================
// LOGIN FUNCTIONALITY
// ========================================

loginForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    clearError();
    setLoading(true);

    const email = document
        .getElementById("email")
        .value.trim();

    const password = document
        .getElementById("password")
        .value;

    try {

        // Validate input
        if (!email || !password) {
            showError("Please enter your email and password.");
            return;
        }

        // Authenticate with Supabase
        const { data, error } =
            await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

        if (error || !data.user || !data.session) {
            showError("Invalid email or password.");
            return;
        }

        // Validate employee profile
        try {

            await validateProfile(data.user.id);

        } catch (profileError) {

            await supabaseClient.auth.signOut({
                scope: "local"
            });

            showError(profileError.message);
            return;
        }

        // Redirect to Tools Portal
        window.location.replace("./portal.html");

    } catch (error) {

        console.error("Authentication error:", error);

        showError(
            "An unexpected error occurred. Please try again."
        );

    } finally {

        setLoading(false);

    }

});


// ========================================
// CHECK EXISTING SESSION
// ========================================

async function initializeLogin() {

    loginButton.disabled = true;

    try {

        const { data, error } =
            await supabaseClient.auth.getUser();

        if (error || !data.user) {
            return;
        }

        try {

            await validateProfile(data.user.id);

            window.location.replace("./portal.html");

        } catch (profileError) {

            await supabaseClient.auth.signOut({
                scope: "local"
            });

            showError(profileError.message);

        }

    } catch (error) {

        console.error("Session validation failed:", error);

    } finally {

        loginButton.disabled = false;

    }

}


// ========================================
// INITIALIZE
// ========================================

// initializeLogin();

loginButton.disabled = false;