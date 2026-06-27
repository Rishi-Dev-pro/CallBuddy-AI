import { useState } from "react";
import axios from "axios";
import { ArrowLeft, LockKeyhole, Mail, Radio, UserRound, Waves } from "lucide-react";
import "./AuthPage.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setPassword("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    setError("");

    if (isRegister && name.trim().length < 2) {
      setError("Please enter your name.");
      return;
    }

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/auth/${isRegister ? "register" : "login"}`,
        isRegister
          ? {
              name: name.trim(),
              email: email.trim(),
              password,
            }
          : {
              email: email.trim(),
              password,
            }
      );

      localStorage.setItem("callbuddy_token", response.data.token);

      onAuthenticated({
        token: response.data.token,
        user: response.data.user,
        session: response.data.session,
      });
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          "Could not connect to CallBuddy right now."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-grid-glow" />

      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <Waves size={20} />
          </div>

          <div>
            <span>CALLBUDDY</span>
            <b>/ AI</b>
          </div>
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">
            <Radio size={13} />
            SECURE TRANSMISSION
          </span>

          <h1>{isRegister ? "Create your command center." : "Welcome back."}</h1>

          <p>
            {isRegister
              ? "Create your CallBuddy account and start a private AI conversation."
              : "Sign in to continue your last active transmission."}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <label>
              <span>
                <UserRound size={14} />
                YOUR NAME
              </span>

              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                maxLength={40}
              />
            </label>
          )}

          <label>
            <span>
              <Mail size={14} />
              EMAIL ADDRESS
            </span>

            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          <label>
            <span>
              <LockKeyhole size={14} />
              PASSWORD
            </span>

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isRegister ? "At least 6 characters" : "Enter your password"}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "ESTABLISHING LINK..."
              : isRegister
              ? "CREATE ACCOUNT"
              : "ENTER CALLBUDDY"}
          </button>
        </form>

        <div className="auth-switch">
          <span>
            {isRegister ? "Already have an account?" : "New to CallBuddy?"}
          </span>

          <button
            type="button"
            onClick={() => switchMode(isRegister ? "login" : "register")}
          >
            {isRegister ? "RETURN TO LOGIN" : "CREATE ACCOUNT"}
          </button>
        </div>

        <p className="auth-footer">
          PRIVATE SESSIONS · CONTEXT MEMORY · CONSENT-BASED VOICE
        </p>
      </div>

      <button
        className="auth-back-button"
        type="button"
        onClick={() => window.location.assign("/")}
        title="Return to CallBuddy"
      >
        <ArrowLeft size={15} />
      </button>
    </main>
  );
}

export default AuthPage;