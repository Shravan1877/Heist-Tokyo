import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sun, Moon, Sparkles, ArrowRight, ShieldCheck, Mail, Lock, AlertTriangle } from "lucide-react";
import { getSupabase, getSupabaseKeys } from "../lib/supabase";

interface LoginProps {
  onLoginSuccess: (email: string, userId: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [otp, setOtp] = useState<string[]>(new Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first OTP field when entering OTP step
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 100);
    }
  }, [step]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address bestie.");
      return;
    }
    
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase connection is not configured or offline. Please declare VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.");
      setLoading(false);
      return;
    }

    try {
      console.log("Supabase sending passwordless OTP to:", email);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
      });

      if (otpError) throw otpError;
      setStep("otp");
    } catch (err: any) {
      console.error("Supabase OTP Error details:", err);
      let errorMsg = err.message || "Failed to trigger security OTP code. Please check your credentials.";
      if (err.status) errorMsg += ` (Status code: ${err.status})`;
      if (err.description) errorMsg += ` - ${err.description}`;
      if (err.details) errorMsg += ` - ${err.details}`;
      
      const extraDetails: string[] = [];
      if (err.error_description) extraDetails.push(`Desc: ${err.error_description}`);
      if (err.error) extraDetails.push(`Error name: ${err.error}`);
      
      if (extraDetails.length > 0) {
        errorMsg += `\n[${extraDetails.join(" / ")}]`;
      }
      
      try {
        const rawJson = JSON.stringify(err);
        if (rawJson && rawJson !== "{}") {
          errorMsg += `\n\nRaw Error details:\n${rawJson}`;
        }
      } catch (pErr) {}

      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    if (isNaN(Number(value))) return;

    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    // Move to next input if value is entered
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Check if OTP is completely filled
    const completedOtp = newOtp.join("");
    if (completedOtp.length === 6) {
      handleVerifyOtp(completedOtp);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      if (!otp[index] && index > 0) {
        const newOtp = [...otp];
        newOtp[index - 1] = "";
        setOtp(newOtp);
        otpRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleVerifyOtp = async (code: string) => {
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase connection is not configured or offline. Please declare VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.");
      setLoading(false);
      return;
    }

    try {
      // Supabase verify OTP endpoint for passwordless login uses 'email' type
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });

      if (verifyError) throw verifyError;

      // Ensure profile entry exists
      const userId = data.user?.id || "";
      if (userId) {
        // Query if profile exists
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (!profile) {
          const isAdmin = email.toLowerCase().trim() === "shravan.p1877@gmail.com";
          // Put clean entry matching the user profiles schema
          await supabase.from("profiles").insert([
            {
              id: userId,
              full_name: email.split("@")[0],
              scan_credits: 5,
              batch_credits: 8,
              is_premium: isAdmin,
              message_count: 0,
            },
          ]);
        }
      }

      onLoginSuccess(email, userId);
    } catch (err: any) {
      console.error("Supabase Verify Error details:", err);
      let errorMsg = err.message || "Invalid or expired verify code bestie. Try again.";
      if (err.status) errorMsg += ` (Status code: ${err.status})`;
      if (err.description) errorMsg += ` - ${err.description}`;
      if (err.details) errorMsg += ` - ${err.details}`;
      
      const extraDetails: string[] = [];
      if (err.error_description) extraDetails.push(`Desc: ${err.error_description}`);
      if (err.error) extraDetails.push(`Error name: ${err.error}`);
      
      if (extraDetails.length > 0) {
        errorMsg += `\n[${extraDetails.join(" / ")}]`;
      }
      
      try {
        const rawJson = JSON.stringify(err);
        if (rawJson && rawJson !== "{}") {
          errorMsg += `\n\nRaw Error details:\n${rawJson}`;
        }
      } catch (pErr) {}

      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#696969] flex flex-col items-center justify-center p-4 md:p-8 font-sans transition-colors duration-300 relative">

      <div id="login-container" className="w-full max-w-md bg-white border-2 border-teal-800/10 rounded-3xl p-6 md:p-10 shadow-xl relative overflow-hidden">
        {/* Aesthetic accents */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-teal-800/5 rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-teal-800/5 rounded-full blur-2xl" />

        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex py-1 px-3 bg-teal-800/10 rounded-full text-teal-800 text-xs font-mono tracking-wider font-extrabold uppercase items-center justify-center">
            <Sparkles size={12} className="mr-1 animate-pulse" />
            HEIST WINGMAN CORE
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-950 uppercase leading-none">
            Elevate your aesthetic
          </h1>
          <p className="text-xs text-slate-600 max-w-xs mx-auto leading-relaxed">
            The premium styling protocol. Real database state with Supabase and custom AI-powered alignment.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {step === "email" ? (
            <motion.div
              key="email-step"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3 }}
            >
              <form onSubmit={handleEmailSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="email-input" className="block text-xs uppercase tracking-widest font-black text-slate-600">
                    Your Email Address
                  </label>
                  <div className="relative flex items-center">
                    <Mail size={16} className="absolute left-4 text-slate-500 z-10" />
                    <input
                      id="email-input"
                      type="email"
                      required
                      placeholder="bestie@heist.style"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="w-full bg-slate-50 border border-slate-300 py-3.5 pl-11 pr-4 rounded-xl text-sm font-bold text-black focus:outline-none focus:border-teal-800 transition-colors placeholder-slate-400 font-medium"
                    />
                  </div>
                </div>

                {error && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-500/20 p-3.5 rounded-xl font-medium whitespace-pre-wrap break-all leading-relaxed font-mono text-left max-h-48 overflow-y-auto">
                    <span className="font-sans font-bold block uppercase tracking-wider text-[10px] mb-1 text-rose-800">Detailed Authentication Error:</span>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-teal-800 hover:bg-teal-900 text-white font-extrabold text-xs tracking-widest uppercase py-4 rounded-xl transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  <span>{loading ? "SENDING ACCESS TOKENS..." : "SEND VERIFICATION CODE"}</span>
                  <ArrowRight size={14} />
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="otp-step"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="space-y-2 text-center overflow-hidden">
                <label className="block text-xs uppercase tracking-widest font-black text-slate-600">
                  Enter 6-Digit Code
                </label>
                <p className="text-[11px] text-slate-500 italic">
                  We sent an access token to <span className="font-bold font-mono text-slate-800">{email}</span>
                </p>
              </div>

              <div className="flex justify-between gap-2 max-w-xs mx-auto py-2">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    id={`otp-input-${index}`}
                    ref={(el) => (otpRefs.current[index] = el)}
                    type="text"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(e.target.value, index)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    disabled={loading}
                    className="w-11 h-12 text-center bg-slate-50 border border-slate-300 rounded-xl text-lg font-black text-black focus:outline-none focus:border-teal-800 transition-all focus:ring-1 focus:ring-teal-800 font-mono"
                  />
                ))}
              </div>

              {error && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-500/20 p-3.5 rounded-xl font-medium whitespace-pre-wrap break-all leading-relaxed font-mono text-left max-h-48 overflow-y-auto">
                  <span className="font-sans font-bold block uppercase tracking-wider text-[10px] mb-1 text-rose-800">Detailed Verification Error:</span>
                  {error}
                </div>
              )}

              <div className="flex flex-col space-y-4 pt-2">
                <button
                  disabled={loading}
                  onClick={() => handleVerifyOtp(otp.join(""))}
                  className="w-full bg-teal-800 hover:bg-teal-900 text-white font-extrabold text-xs tracking-widest uppercase py-4 rounded-xl transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  <Lock size={12} className="mr-0.5" />
                  <span>{loading ? "VERIFYING SECURITY TOKENS..." : "VERIFY AND UNLOCK"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setOtp(new Array(6).fill(""));
                  }}
                  className="text-center text-xs text-teal-800 font-black tracking-wider uppercase hover:underline"
                >
                  Restart Login Flow
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-8 pt-4 border-t border-slate-100 flex flex-col items-center space-y-2 text-[10px] text-slate-400 font-mono tracking-widest uppercase select-none">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck size={12} className="text-teal-800/40" />
            <span>SUPABASE AUTH PROTOCOL</span>
          </div>
          <div className="flex items-center space-x-3 text-[10px] text-slate-500 font-medium font-sans lowercase tracking-tight">
            <button 
              type="button"
              onClick={() => {
                window.history.pushState({}, "", "/legal");
                window.dispatchEvent(new Event("heist-navigate"));
              }}
              className="hover:text-teal-800 transition cursor-pointer font-bold underline"
            >
              Refund, Privacy & Terms Policies
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
