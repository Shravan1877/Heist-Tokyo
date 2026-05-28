import React, { useState, useEffect } from "react";
import Login from "./components/Login";
import Onboarding from "./components/Onboarding";
import InstallPrompt from "./components/InstallPrompt";

export default function App() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Check persistent login on mount and fetch Supabase config dynamically
  useEffect(() => {
    async function initConfigAndSession() {
      try {
        const res = await fetch("/api/supabase-config");
        if (res.ok) {
          const config = await res.json();
          if (config.url && config.key) {
            const { initSupabaseKeys } = await import("./lib/supabase");
            initSupabaseKeys(config.url, config.key);
          }
        }
      } catch (err) {
        console.warn("Failed loading Dynamic Supabase configuration:", err);
      }

      const savedEmail = localStorage.getItem("heist_user_email");
      const savedUserId = localStorage.getItem("heist_user_id");
      if (savedEmail) {
        setUserEmail(savedEmail);
        setUserId(savedUserId || `user_${Date.now()}`);
      }
      setIsLoading(false);
    }

    initConfigAndSession();
  }, []);

  const handleLoginSuccess = (email: string, id: string) => {
    localStorage.setItem("heist_user_email", email);
    localStorage.setItem("heist_user_id", id);
    setUserEmail(email);
    setUserId(id);
  };

  const handleLogout = () => {
    localStorage.removeItem("heist_user_email");
    localStorage.removeItem("heist_user_id");
    setUserEmail(null);
    setUserId(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[#696969] flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-teal-900 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs uppercase font-extrabold tracking-widest text-teal-950">
            Securing Connection...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#696969] overflow-hidden flex flex-col animate-fadeIn">
      {userEmail && userId ? (
        <Onboarding 
          userEmail={userEmail} 
          userId={userId} 
          onLogout={handleLogout} 
        />
      ) : (
        <Login 
          onLoginSuccess={handleLoginSuccess} 
        />
      )}
      <InstallPrompt />
    </div>
  );
}