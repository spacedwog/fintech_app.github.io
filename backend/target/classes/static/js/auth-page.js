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
    this.oauthConsentModal = document.getElementById("oauth-consent-modal");
    this.oauthConsentContinueBtn = document.getElementById("oauth-consent-continue");
    this.oauthConsentCancelBtn = document.getElementById("oauth-consent-cancel");
    this.oauthConsentError = document.getElementById("oauth-consent-error");
    this.pendingLogin = null;
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
    if (this.oauthConsentContinueBtn) {
      this.oauthConsentContinueBtn.addEventListener("click", () => this._confirmOAuthConsent());
    }
    if (this.oauthConsentCancelBtn) {
      this.oauthConsentCancelBtn.addEventListener("click", () => this._closeOAuthConsentModal());
    }
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

    this.pendingLogin = {
      email: document.getElementById("login-email").value.trim(),
      password: document.getElementById("login-password").value,
    };
    this._openOAuthConsentModal();
  }

  _openOAuthConsentModal() {
    if (!this.oauthConsentModal) return;
    if (this.oauthConsentError) this.oauthConsentError.classList.add("hidden");
    this.oauthConsentModal.classList.remove("hidden");
  }

  _closeOAuthConsentModal() {
    if (!this.oauthConsentModal) return;
    this.oauthConsentModal.classList.add("hidden");
    if (this.oauthConsentError) this.oauthConsentError.classList.add("hidden");
  }

  async _confirmOAuthConsent() {
    if (!this.pendingLogin) return;
    const errorBox = document.getElementById("login-error");
    errorBox.classList.add("hidden");
    if (this.oauthConsentError) this.oauthConsentError.classList.add("hidden");
    if (this.oauthConsentContinueBtn) this.oauthConsentContinueBtn.disabled = true;

    try {
      const { token } = await Api.login({
        email: this.pendingLogin.email,
        password: this.pendingLogin.password,
        oauth_consent: true,
      });
      this.pendingLogin = null;
      this._closeOAuthConsentModal();
      Auth.setToken(token);
      window.location.href = "dashboard.html";
    } catch (err) {
      if (this.oauthConsentError) {
        this.oauthConsentError.textContent = err.message;
        this.oauthConsentError.classList.remove("hidden");
      } else {
        errorBox.textContent = err.message;
        errorBox.classList.remove("hidden");
      }
    } finally {
      if (this.oauthConsentContinueBtn) this.oauthConsentContinueBtn.disabled = false;
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
