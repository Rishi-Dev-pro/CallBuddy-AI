import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import "./index.css";
import App from "./App.jsx";
import VoiceRoom from "./VoiceRoom.jsx";
import AuthPage from "./AuthPage.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function RootRouter() {
  const isVoiceRoomPage = window.location.pathname.startsWith("/voice-room/");

  const [authState, setAuthState] = useState({
    checking: true,
    token: localStorage.getItem("callbuddy_token"),
    user: null,
    session: null,
  });

  useEffect(() => {
    const restoreLogin = async () => {
      const token = localStorage.getItem("callbuddy_token");

      if (!token) {
        setAuthState({
          checking: false,
          token: null,
          user: null,
          session: null,
        });
        return;
      }

      try {
        const response = await axios.get(`${API_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        setAuthState({
          checking: false,
          token,
          user: response.data.user,
          session: response.data.session,
        });
      } catch (error) {
        console.error("Could not restore CallBuddy login:", error);

        localStorage.removeItem("callbuddy_token");

        setAuthState({
          checking: false,
          token: null,
          user: null,
          session: null,
        });
      }
    };

    restoreLogin();
  }, []);

  const handleAuthenticated = ({ token, user, session }) => {
    setAuthState({
      checking: false,
      token,
      user,
      session,
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("callbuddy_token");

    setAuthState({
      checking: false,
      token: null,
      user: null,
      session: null,
    });

    window.history.replaceState({}, "", "/");
  };

  /*
    IMPORTANT:
    Voice Room links are public.
    Guests can enter with only their name.
    Logged-in users still get their token + account name automatically.
  */
  if (isVoiceRoomPage) {
    return (
      <VoiceRoom
    token={authState.token}
    currentUser={authState.user}
    isAuthLoading={authState.checking}
    onLogout={handleLogout}
/>
    );
  }

  if (authState.checking) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#10110f",
          color: "#b7ff36",
          fontFamily: '"DM Mono", monospace',
          fontSize: "11px",
          letterSpacing: "0.12em",
        }}
      >
        RESTORING TRANSMISSION...
      </main>
    );
  }

  if (!authState.token || !authState.user) {
    return <AuthPage onAuthenticated={handleAuthenticated} />;
  }

  return (
    <App
      token={authState.token}
      currentUser={authState.user}
      initialSession={authState.session}
      onLogout={handleLogout}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RootRouter />
  </StrictMode>
);