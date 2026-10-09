import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { initConnection } from "@/lib/solanaClient";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Checkout from "@/pages/Checkout";
import "@/App.css";

export const ConfigContext = { current: null };

function Gate({ children }) {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-quantum-ink">
        <div className="font-plex-mono text-sm text-quantum-green">
          booting quantum_pos<span className="cursor-blink">▊</span>
        </div>
      </div>
    );
  }
  return children;
}

function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.get("/config").then(({ data }) => {
      ConfigContext.current = data;
      initConnection();
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  return (
    <div className="App noise min-h-screen bg-quantum-ink">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Gate><Landing /></Gate>} />
            <Route path="/app" element={<Gate><Dashboard /></Gate>} />
            <Route path="/dashboard" element={<Navigate to="/app" replace />} />
            <Route path="/pay/:id" element={<Checkout />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
}

export default App;
