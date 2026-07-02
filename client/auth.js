const AUTH_TOKEN_KEY = "token";
const API_OVERRIDE_KEY = "apiBaseUrl";
const DEFAULT_API_BASE = "https://artfullhours.onrender.com";

function normalizeBase(base) {
  return String(base || "").trim().replace(/\/$/, "");
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}
function getApiCandidates() {
  const override = normalizeBase(localStorage.getItem(API_OVERRIDE_KEY));

  const candidates = [];

  if (override) {
    candidates.push(override);
  }

  // 🔥 PRODUCTION BACKEND (Render)
  candidates.push(DEFAULT_API_BASE);

  // Local fallback (for development)
  candidates.push("http://localhost:5000", "http://127.0.0.1:5000");

  return unique(candidates);
}

let activeApiBase = getApiCandidates()[0] || "";

function rememberWorkingBase(base) {
  activeApiBase = normalizeBase(base);
  if (activeApiBase) {
    localStorage.setItem(API_OVERRIDE_KEY, activeApiBase);
  } else {
    localStorage.removeItem(API_OVERRIDE_KEY);
  }
}

function parseJsonSafe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_e) {
    return {};
  }
}

function buildCandidateBases() {
  return unique([activeApiBase, ...getApiCandidates()]);
}

function showMessage(type, text) {
  const errorEl = document.getElementById("errorMsg");
  const successEl = document.getElementById("successMsg");

  if (errorEl) {
    errorEl.style.display = type === "error" ? "block" : "none";
    errorEl.textContent = type === "error" ? text : "";
  }

  if (successEl) {
    successEl.style.display = type === "success" ? "block" : "none";
    successEl.textContent = type === "success" ? text : "";
  }
}

function inferNameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "User";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "User";
}

function buildClientPath(path) {
  if (window.location.protocol === "file:") {
    return path.replace(/^\//, "");  // Remove leading / for file://
  }
  return path.startsWith("/") ? `${window.location.origin}${path}` : `${window.location.origin}/${path}`;
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const candidateBases = buildCandidateBases();
  const networkFailures = [];

  for (let i = 0; i < candidateBases.length; i += 1) {
    const base = candidateBases[i];
    const url = `${base}${path}`;

    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (_e) {
      networkFailures.push(url);
      continue;
    }

    const rawText = await response.text();
    const payload = parseJsonSafe(rawText);

    if (response.ok) {
      rememberWorkingBase(base);
      return payload;
    }

    if (response.status === 404 && i < candidateBases.length - 1) {
      networkFailures.push(url);
      continue;
    }

    throw new Error(payload.message || `Request failed (${response.status})`);
  }

  const attempted = networkFailures.length ? ` Tried: ${networkFailures.join(", ")}` : "";
  throw new Error(`Cannot reach server. Run .\\start-local.ps1 and open http://localhost:5000.${attempted}`);
}

async function handleSignup() {
  const nameEl = document.getElementById("signupName");
  const emailEl = document.getElementById("signupEmail");
  const passwordEl = document.getElementById("signupPassword");
  const buttonEl = document.getElementById("signupBtn");

  if (!emailEl || !passwordEl || !buttonEl) {
    return;
  }

  buttonEl.disabled = true;
  const originalLabel = buttonEl.textContent;
  buttonEl.textContent = "Creating account...";

  try {
    const email = emailEl.value.trim();
    const password = passwordEl.value;
    const nameInput = nameEl ? nameEl.value.trim() : "";

    if (!email) {
      throw new Error("Email is required");
    }

    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const payload = {
      name: nameInput || inferNameFromEmail(email),
      email,
      password
    };

    const data = await apiRequest(API_BASE_URL + "/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (data.token) {
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    }

    showMessage("success", data.message || "Signup successful. Redirecting to your app...");
    setTimeout(() => {
      window.location.href = data.token ? buildClientPath("/app.html") : buildClientPath("/login.html");
    }, 900);
  } catch (error) {
    showMessage("error", error.message || "Signup failed");
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
  }
}

async function handleLogin() {
  const emailEl = document.getElementById("loginEmail");
  const passwordEl = document.getElementById("loginPassword");
  const buttonEl = document.getElementById("loginBtn");

  if (!emailEl || !passwordEl || !buttonEl) {
    return;
  }

  buttonEl.disabled = true;
  const originalLabel = buttonEl.textContent;
  buttonEl.textContent = "Signing in...";

  try {
    const identifier = emailEl.value.trim();
    const password = passwordEl.value;

    if (!identifier || !password) {
      throw new Error("Please enter your email and password");
    }

    const data = await apiRequest(API_BASE_URL + "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });

    if (data.token) {
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    }

    showMessage("success", data.message || "Login successful. Redirecting to app...");
    setTimeout(() => {
      window.location.href = buildClientPath("/app.html");
    }, 700);
  } catch (error) {
    showMessage("error", error.message || "Login failed");
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
  }
}

async function handleRequestLoginOtp() {
  const identifierEl = document.getElementById("loginEmail");
  const otpBtn = document.getElementById("getOtpBtn");
  if (!identifierEl || !otpBtn) return;

  const identifier = identifierEl.value.trim();
  if (!identifier) {
    showMessage("error", "Please enter email or phone before requesting OTP.");
    return;
  }

  const originalLabel = otpBtn.textContent;
  otpBtn.disabled = true;
  otpBtn.textContent = "Sending OTP...";

  try {
    const data = await apiRequest("/api/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({ identifier, purpose: "LOGIN" })
    });

    if (data.otp) {
      showMessage("success", `OTP: ${data.otp} (demo mode)`);
    } else {
      showMessage("success", data.message || "OTP sent successfully");
    }
  } catch (error) {
    showMessage("error", error.message || "Could not send OTP");
  } finally {
    otpBtn.disabled = false;
    otpBtn.textContent = originalLabel;
  }
}

async function handleLoginWithOtp() {
  const identifierEl = document.getElementById("loginEmail");
  const otpEl = document.getElementById("loginOtp");
  const otpLoginBtn = document.getElementById("loginOtpBtn");
  if (!identifierEl || !otpEl || !otpLoginBtn) return;

  const identifier = identifierEl.value.trim();
  const otp = otpEl.value.trim();
  if (!identifier || !otp) {
    showMessage("error", "Please enter email/phone and OTP.");
    return;
  }

  const originalLabel = otpLoginBtn.textContent;
  otpLoginBtn.disabled = true;
  otpLoginBtn.textContent = "Verifying OTP...";

  try {
    const data = await apiRequest("/api/auth/login-otp", {
      method: "POST",
      body: JSON.stringify({ identifier, otp })
    });

    if (data.token) {
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    }

    showMessage("success", data.message || "OTP login successful. Redirecting to app...");
    setTimeout(() => {
      window.location.href = buildClientPath("/app.html");
    }, 700);
  } catch (error) {
    showMessage("error", error.message || "OTP login failed");
  } finally {
    otpLoginBtn.disabled = false;
    otpLoginBtn.textContent = originalLabel;
  }
}

async function handleForgotPassword() {
  const emailEl = document.getElementById("loginEmail");
  const forgotBox = document.getElementById("forgotPasswordBox");
  const otpInput = document.getElementById("forgotOtp");
  const newPasswordInput = document.getElementById("forgotNewPassword");
  const identifier = emailEl ? emailEl.value.trim() : "";

  if (!identifier) {
    showMessage("error", "Enter your email first, then click Forgot Password.");
    return;
  }

  try {
    const otpRes = await apiRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ identifier })
    });

    if (forgotBox) forgotBox.style.display = "block";
    if (otpInput) otpInput.value = "";
    if (newPasswordInput) newPasswordInput.value = "";

    if (otpRes.otp) {
      showMessage("success", `OTP sent. Demo OTP: ${otpRes.otp}`);
    } else {
      showMessage("success", otpRes.message || "Reset OTP sent. Enter OTP and new password below.");
    }
  } catch (error) {
    showMessage("error", error.message || "Could not reset password");
  }
}

async function handleResetPassword() {
  const emailEl = document.getElementById("loginEmail");
  const otpInput = document.getElementById("forgotOtp");
  const newPasswordInput = document.getElementById("forgotNewPassword");

  const identifier = emailEl ? emailEl.value.trim() : "";
  const otp = otpInput ? otpInput.value.trim() : "";
  const newPassword = newPasswordInput ? newPasswordInput.value : "";

  if (!identifier) {
    showMessage("error", "Enter your email or phone first.");
    return;
  }

  if (!otp) {
    showMessage("error", "Enter the reset OTP.");
    return;
  }

  if (!newPassword || newPassword.length < 6) {
    showMessage("error", "New password must be at least 6 characters");
    return;
  }

  try {
    const resetRes = await apiRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ identifier, otp, newPassword })
    });
    showMessage("success", resetRes.message || "Password reset successful. You can now sign in.");
    if (newPasswordInput) newPasswordInput.value = "";
    if (otpInput) otpInput.value = "";
  } catch (error) {
    showMessage("error", error.message || "Could not reset password");
  }
}

function wireSignupPage() {
  const signupBtn = document.getElementById("signupBtn");
  if (!signupBtn) {
    return;
  }

  signupBtn.addEventListener("click", handleSignup);

  const passwordEl = document.getElementById("signupPassword");
  if (passwordEl) {
    passwordEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleSignup();
      }
    });
  }
}

function wireLoginPage() {
  const loginBtn = document.getElementById("loginBtn");
  if (!loginBtn) {
    return;
  }

  loginBtn.textContent = "Login with Password";

  loginBtn.addEventListener("click", handleLogin);

  const getOtpBtn = document.getElementById("getOtpBtn");
  if (getOtpBtn) {
    getOtpBtn.addEventListener("click", handleRequestLoginOtp);
  }

  const loginOtpBtn = document.getElementById("loginOtpBtn");
  if (loginOtpBtn) {
    loginOtpBtn.addEventListener("click", handleLoginWithOtp);
  }

  const forgotBtn = document.getElementById("forgotPasswordBtn");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", (event) => {
      event.preventDefault();
      handleForgotPassword();
    });
  }

  const resetPasswordBtn = document.getElementById("resetPasswordBtn");
  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener("click", handleResetPassword);
  }

  const passwordEl = document.getElementById("loginPassword");
  if (passwordEl) {
    passwordEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleLogin();
      }
    });
  }

  const otpEl = document.getElementById("loginOtp");
  if (otpEl) {
    otpEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleLoginWithOtp();
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireSignupPage();
  wireLoginPage();
});
