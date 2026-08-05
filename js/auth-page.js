// ===============================
// frontend/js/auth-page.js
// Lógica da tela de login/signup (login.html)
//
// Reescrito em POO: AuthPageController encapsula os elementos do DOM e
// os handlers de login/signup/alternância de formulário.
// ===============================

class AuthPageController {
  constructor() {
    this.loginForm = document.getElementById("login-form");
    this.signupForm = document.getElementById("signup-form");
    this.showSignup = document.getElementById("show-signup");
    this.showLogin = document.getElementById("show-login");
    this.loginBox = document.getElementById("login-box");
    this.signupBox = document.getElementById("signup-box");
  }

  init() {
    if (Auth.isLoggedIn()) {
      window.location.href = "dashboard.html";
      return;
    }

    this.showSignup.addEventListener("click", (e) => this._handleShowSignup(e));
    this.showLogin.addEventListener("click", (e) => this._handleShowLogin(e));
    this.loginForm.addEventListener("submit", (e) => this._handleLoginSubmit(e));
    this.signupForm.addEventListener("submit", (e) => this._handleSignupSubmit(e));
  }

  _handleShowSignup(e) {
    e.preventDefault();
    this.loginBox.classList.add("hidden");
    this.signupBox.classList.remove("hidden");
  }

  _handleShowLogin(e) {
    e.preventDefault();
    this.signupBox.classList.add("hidden");
    this.loginBox.classList.remove("hidden");
  }

  async _handleLoginSubmit(e) {
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
  }

  async _handleSignupSubmit(e) {
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
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new AuthPageController().init();
});
