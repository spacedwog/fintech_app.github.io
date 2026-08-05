// ===============================
// frontend/js/auth-page.js
// Lógica da tela de login/signup (index.html)
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  if (Auth.isLoggedIn()) {
    window.location.href = "dashboard.html";
    return;
  }

  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const showSignup = document.getElementById("show-signup");
  const showLogin = document.getElementById("show-login");
  const loginBox = document.getElementById("login-box");
  const signupBox = document.getElementById("signup-box");

  showSignup.addEventListener("click", (e) => {
    e.preventDefault();
    loginBox.classList.add("hidden");
    signupBox.classList.remove("hidden");
  });

  showLogin.addEventListener("click", (e) => {
    e.preventDefault();
    signupBox.classList.add("hidden");
    loginBox.classList.remove("hidden");
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("login-error");
    errorBox.classList.add("hidden");

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const { token } = await Api.login({ email, password });
      Auth.setToken(token);
      window.location.href = "dashboard.html";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("signup-error");
    errorBox.classList.add("hidden");

    const company_name = document.getElementById("signup-company").value.trim();
    const admin_name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;

    try {
      const { token } = await Api.signup({ company_name, admin_name, email, password });
      Auth.setToken(token);
      window.location.href = "dashboard.html";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  });
});
