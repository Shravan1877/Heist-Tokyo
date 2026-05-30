import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Sparkles, User, RefreshCw, LogOut, CheckCircle2, Lock, Settings, X, Image } from "lucide-react";
import { getSupabase } from "../lib/supabase";

interface OnboardingProps {
  userEmail: string;
  userId: string;
  onLogout: () => void;
}

interface ChatMessage {
  id: string;
  role: "tokyo" | "user" | "system";
  content: string;
  timestamp: Date;
  photo?: string;
}

// RFC4122 compliant UUID structure helper
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Pseudo-UUID deterministic translations to map custom sandbox identifiers safely to standard UUID formatting
function getSafeUUID(rawId: string): string {
  const clean = rawId.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
    return clean;
  }
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hex = Math.abs(hash).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex.substring(0, 12)}`;
}

export default function Onboarding({ userEmail, userId, onLogout }: OnboardingProps) {
  const [currentStage, setCurrentStage] = useState<number>(1);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [answers, setAnswers] = useState<Record<string, string>>({
    vibe: "",
    fit: "",
    lifestyle: "",
    ick: "",
    hook: ""
  });

  const [paywallActive, setPaywallActive] = useState<boolean>(false);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(
    userEmail.toLowerCase().trim() === "shravan.p1877@gmail.com"
  );
  const [isOnboardingDone, setIsOnboardingDone] = useState<boolean>(false);

  const [superragStatus, setSuperragStatus] = useState<{ active_api: boolean; characters: number } | null>(null);
  const [showRestorePrompt, setShowRestorePrompt] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load initial SuperRAG API activation status check
  useEffect(() => {
    async function checkConfig() {
      try {
        const response = await fetch("/api/config-status");
        if (response.ok) {
          const statusResult = await response.json();
          setSuperragStatus({
            active_api: statusResult.superrag_configured,
            characters: 0
          });
        }
      } catch (err) {
        console.warn("Could not load API status config:", err);
      }
    }
    checkConfig();
  }, []);

  const handleImageUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load existing profile & historical chat dumps from localStorage / Supabase
  useEffect(() => {
    const historyKey = `heist_chat_history_${userId}`;
    const answersKey = `heist_onboarding_answers_${userId}`;
    const stageKey = `heist_current_stage_${userId}`;
    const doneKey = `heist_onboarding_done_${userId}`;

    const cachedHistoryStr = localStorage.getItem(historyKey);
    const cachedAnswersStr = localStorage.getItem(answersKey);
    const cachedStageStr = localStorage.getItem(stageKey);
    const cachedDoneStr = localStorage.getItem(doneKey);

    let hasCached = false;
    if (cachedHistoryStr) {
      try {
        const parsedHistory = JSON.parse(cachedHistoryStr).map((m: any) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
        }));
        setMessages(parsedHistory);
        
        if (cachedAnswersStr) {
          setAnswers(JSON.parse(cachedAnswersStr));
        }
        if (cachedStageStr) {
          setCurrentStage(parseInt(cachedStageStr, 10) || -2);
        }
        if (cachedDoneStr) {
          setIsOnboardingDone(cachedDoneStr === "true");
        }
        hasCached = true;
      } catch (err) {
        console.warn("Could not parse cached chat history:", err);
      }
    }

    async function loadProfileAndVerifyCloudSession() {
      const supabase = getSupabase();
      if (!supabase || !userId) return;
      
      try {
        // Query Profile for premium validation
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_premium")
          .eq("id", userId)
          .single();
          
        if (profile && profile.is_premium) {
          setPaymentSuccess(true);
        }

        // If no cached local history exists, check if a cloud session exists for recovery trigger
        if (!hasCached) {
          const safeUserId = getSafeUUID(userId);
          const { data: sessions, error } = await supabase
            .from("heist_sessions")
            .select("session_id")
            .eq("user_id", safeUserId)
            .limit(1);

          if (sessions && sessions.length > 0) {
            setShowRestorePrompt(true);
          }
        }
      } catch (err) {
        console.error("Error loading account profile configuration:", err);
      }
    }

    loadProfileAndVerifyCloudSession();

    // Trigger initial onboarding question of Stage -2 only if there is absolutely no cache
    if (!hasCached) {
      setIsTyping(true);
      const timer = setTimeout(() => {
        setMessages([
          {
            id: "init_msg",
            role: "tokyo",
            content: "Welcome to Tokyo! 🌸 Before we begin, let's analyze your canvas. Please upload a clear photo of your Front Profile first so I can map your exact structure!",
            timestamp: new Date()
          }
        ]);
        setCurrentStage(-2);
        setIsTyping(false);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [userId]);

  // Core 5 Onboarding script
  const STAGE_QUESTIONS: Record<number, string> = {
    1: "What kind of fashion do you like? What's your ultimate styling vibe? (Old Money, French Riviera, Streetwear?)",
    2: "Are we swimming in oversized stuff, or keeping it tailored?",
    3: "Where is your energy going right now? Grinding at work, uni, or just focusing on yourself?",
    4: "What is one fashion trend that gives you the immediate ick?",
    5: "So you're grinding on [Lifestyle] and aiming for [Vibe]. Tell me the truth—why the sudden focus on elevating your look right now? Trying to impress someone, or pure self-improvement?"
  };

  // Preset choices for chips to make interaction extremely sleek
  const STAGE_PRESETS: Record<number, string[]> = {
    1: ["Old Money", "French Riviera", "Streetwear"],
    2: ["Oversized & Baggy", "Tailored & Sharp", "Classic regular fit"],
    3: ["Grinding at work", "Surviving uni", "Focusing on myself"],
    4: ["Thin skinny jeans", "Slogan Graphic T-Shirts", "No-show socks in sneakers", "Ill-fitting fast fashion"],
    5: ["Trying to impress someone", "Pure self-improvement"]
  };

  // Get dynamic question text for stage 5
  const getQuestionText = (stage: number) => {
    let text = STAGE_QUESTIONS[stage];
    if (stage === 5) {
      text = text
        .replace("[Lifestyle]", answers.lifestyle || "your Grind")
        .replace("[Vibe]", answers.vibe || "the top Vibe");
    }
    return text;
  };

  // Auto scroll to chat base
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Sync to local state instantly on modification
  useEffect(() => {
    if (messages.length === 0) return;
    const historyKey = `heist_chat_history_${userId}`;
    const answersKey = `heist_onboarding_answers_${userId}`;
    const stageKey = `heist_current_stage_${userId}`;
    const doneKey = `heist_onboarding_done_${userId}`;

    localStorage.setItem(historyKey, JSON.stringify(messages));
    localStorage.setItem(answersKey, JSON.stringify(answers));
    localStorage.setItem(stageKey, String(currentStage));
    localStorage.setItem(doneKey, String(isOnboardingDone));
  }, [messages, answers, currentStage, isOnboardingDone, userId]);

  // Save the full updated array to heist_sessions in Supabase in background
  useEffect(() => {
    if (messages.length === 0 || !userId) return;
    const supabase = getSupabase();
    if (!supabase) return;

    // Embed current state metadata as standard system message at the end of the JSON array dump
    const enrichedHistory = [
      ...messages,
      {
        id: "heist_state_metadata",
        role: "system" as const,
        content: "METADATA",
        metadata: {
          answers,
          currentStage,
          isOnboardingDone
        },
        timestamp: new Date().toISOString()
      }
    ];

    const timer = setTimeout(async () => {
      try {
        const safeUserId = getSafeUUID(userId);
        const sessionKey = `heist_session_id_${userId}`;
        let safeSessionId = localStorage.getItem(sessionKey);
        if (!safeSessionId) {
          safeSessionId = generateUUID();
          localStorage.setItem(sessionKey, safeSessionId);
        }
        const cleanSessionId = getSafeUUID(safeSessionId);

        console.log(`[Database Sync] Upserting heist_sessions for user: ${safeUserId}`);
        await supabase
          .from("heist_sessions")
          .upsert({
            session_id: cleanSessionId,
            user_id: safeUserId,
            chat_history: enrichedHistory,
            updated_at: new Date().toISOString()
          }, {
            onConflict: "session_id"
          });
      } catch (err) {
        console.warn("[Database Sync Failure] heist_sessions update offline:", err);
      }
    }, 1000); // Debounce database saves by 1s

    return () => clearTimeout(timer);
  }, [messages, answers, currentStage, isOnboardingDone, userId]);

  // Recover session row from Supabase JSON dump
  const handleRestoreCloudSession = async () => {
    const supabase = getSupabase();
    if (!supabase || !userId) return;
    setIsRestoring(true);
    try {
      const safeUserId = getSafeUUID(userId);
      console.log("[Recovery] Attempting database row restore for user:", safeUserId);
      const { data, error } = await supabase
        .from("heist_sessions")
        .select("*")
        .eq("user_id", safeUserId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const row = data[0];
        const rawHistory = row.chat_history;
        if (Array.isArray(rawHistory)) {
          // Extract metadata if exists
          const metaMsg = rawHistory.find(m => m.id === "heist_state_metadata");
          let cleanHistory = [...rawHistory];
          
          if (metaMsg && metaMsg.metadata) {
            const meta = metaMsg.metadata;
            if (meta.answers) setAnswers(meta.answers);
            if (meta.currentStage) setCurrentStage(meta.currentStage);
            if (meta.isOnboardingDone !== undefined) setIsOnboardingDone(meta.isOnboardingDone);
            
            // Filter out state metadata message
            cleanHistory = cleanHistory.filter(m => m.id !== "heist_state_metadata");
          }

          const parsedHistory = cleanHistory.map((m: any) => ({
            ...m,
            timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
          }));

          const historyKey = `heist_chat_history_${userId}`;
          const sessionKey = `heist_session_id_${userId}`;

          setMessages(parsedHistory);
          localStorage.setItem(sessionKey, row.session_id);
          localStorage.setItem(historyKey, JSON.stringify(parsedHistory));
          
          setShowRestorePrompt(false);
          console.log("[Recovery] Successfully restored and auto-synced locally.");
        }
      } else {
        console.log("[Recovery] No cloud session found for user:", safeUserId);
      }
    } catch (err) {
      console.warn("[Recovery Error] Restore failed:", err);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleUserAnswer = async (text: string) => {
    if ((!text.trim() && !selectedImage) || isTyping || paywallActive) return;

    // Check Stage -2 photo requirement
    if (currentStage === -2 && !selectedImage && !isOnboardingDone) {
      const salt = Math.random().toString(36).substring(2, 8);
      setMessages((prev) => [
        ...prev,
        {
          id: `tokyo_re_upload_front_${Date.now()}_${salt}`,
          role: "tokyo",
          content: "Bestie, I need that front profile photo first! Click 'Upload Front Profile Photo' or the camera icon below to upload. 📸",
          timestamp: new Date()
        }
      ]);
      return;
    }

    // Check Stage -1 photo requirement
    if (currentStage === -1 && !selectedImage && !isOnboardingDone) {
      const salt = Math.random().toString(36).substring(2, 8);
      setMessages((prev) => [
        ...prev,
        {
          id: `tokyo_re_upload_side_${Date.now()}_${salt}`,
          role: "tokyo",
          content: "I need that side profile photo to complete the 3D map, bestie! Click 'Upload Side Profile Photo' or the camera icon below to upload. 📸",
          timestamp: new Date()
        }
      ]);
      return;
    }

    // Append user's message with extra salt to absolutely protect against key collision
    const salt = Math.random().toString(36).substring(2, 8);
    const newMsg: ChatMessage = {
      id: `user_${Date.now()}_${salt}`,
      role: "user",
      content: text || "Selected profile photo check 📸",
      photo: selectedImage || undefined,
      timestamp: new Date()
    };
    
    // Store selectedImage in temp to send
    const tempImageToSend = selectedImage;

    setMessages((prev) => [...prev, newMsg]);
    setUserInput("");
    setSelectedImage(null);
    setIsTyping(true);

    // Save message trace metrics to Supabase profiles database table
    try {
      const supabase = getSupabase();
      if (supabase && userId) {
        supabase.from("profiles")
          .select("message_count")
          .eq("id", userId)
          .single()
          .then(({ data }) => {
            const currentCount = data?.message_count || 0;
            supabase.from("profiles")
              .update({ message_count: currentCount + 1 })
              .eq("id", userId)
              .then(() => {});
          });
      }
    } catch (dbErr) {
      console.warn("Telemetry warning:", dbErr);
    }

    // Conversational Chat path
    if (isOnboardingDone) {
      try {
        const response = await fetch("/api/tokyo/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            user_id: userId,
            message: text,
            answers: answers,
            history: messages.map(m => ({ role: m.role, content: m.content })),
            photo: tempImageToSend || undefined,
            is_test: false
          })
        });
        
        const data = await response.json();
        setIsTyping(false);

        if (data.detected_gender) {
          setAnswers(prev => ({ ...prev, gender: data.detected_gender }));
        }

        if (data.superrag) {
          setSuperragStatus({
            active_api: data.superrag.active_api,
            characters: data.superrag.characters || 0
          });
        }
        
        const replyText = data.text || "Bestie, I love that so much! Tell me, what coordinate are we styling next?";
        const replyMsg: ChatMessage = {
          id: `tokyo_chat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          role: "tokyo",
          content: replyText,
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, replyMsg]);
      } catch (err) {
        console.error("Tokyo Chat Error:", err);
        setIsTyping(false);
        const replyMsg: ChatMessage = {
          id: `tokyo_fail_${Date.now()}`,
          role: "tokyo",
          content: "Sorry bestie, my connection hiccuped for a hot second. But your fit is still literally 10/10 today. Speak to me!",
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, replyMsg]);
      }
      return;
    }

    // Photo scan Stage -2 transitions to Stage -1
    if (currentStage === -2) {
      setTimeout(() => {
        setIsTyping(false);
        setCurrentStage(-1);
        setMessages((prev) => [
          ...prev,
          {
            id: `tokyo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            role: "tokyo",
            content: "Secured! Omg, your front profile is giving elite canvas vibes. Now, please upload your Side Profile photo so we secure the full 3D alignment! 📸",
            timestamp: new Date()
          }
        ]);
      }, 1500);
      return;
    }

    // Photo scan Stage -1 transitions to Stage 1
    if (currentStage === -1) {
      setTimeout(() => {
        setIsTyping(false);
        setCurrentStage(1);
        setMessages((prev) => [
          ...prev,
          {
            id: `tokyo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            role: "tokyo",
            content: "Both scans secured—literally obsessed with your structure. Now let's lock in the style recipe. First up: What kind of fashion do you like? What's your ultimate styling vibe? (Old Money, French Riviera, Streetwear?)",
            timestamp: new Date()
          }
        ]);
      }, 1500);
      return;
    }

    // Onboarding Mode Step Progression
    const currentKey = 
      currentStage === 1 ? "vibe" :
      currentStage === 2 ? "fit" :
      currentStage === 3 ? "lifestyle" :
      currentStage === 4 ? "ick" : "hook";

    const updatedAnswers = { ...answers, [currentKey]: text };
    setAnswers(updatedAnswers);

    try {
      const response = await fetch("/api/tokyo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          message: text,
          answers: updatedAnswers,
          current_onboarding_stage: currentStage,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          is_test: false
        })
      });
      const data = await response.json();
      setIsTyping(false);

      if (data.detected_gender) {
        updatedAnswers.gender = data.detected_gender;
        setAnswers(updatedAnswers);
      }

      const replyText = data.text || "Bestie, I love that answer so much!";
      setMessages((prev) => [
        ...prev,
        {
          id: `tokyo_onboard_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          role: "tokyo",
          content: replyText,
          timestamp: new Date()
        }
      ]);

      if (currentStage < 5) {
        setCurrentStage(currentStage + 1);
      } else {
        // Submit answer to Stage 5 complete -> Launch Paywall Trap unless Admin
        const isAdmin = userEmail.toLowerCase().trim() === "shravan.p1877@gmail.com";
        if (isAdmin) {
          setPaymentSuccess(true);
          setIsOnboardingDone(true);
          setMessages((prev) => [
            ...prev,
            {
              id: `premium_unlocked_msg_${Date.now()}`,
              role: "tokyo",
              content: `✨ CONGRATULATIONS BESTIE! ADMIN PROFILE IDENTIFIED - PREMIUM UNLOCKED FOR shravan.p1877@gmail.com ✨\n\nI have locked in your full profile. Here is your style recipe:\n\n🥋 SILHOUETTE:\nKeeping it relaxed with high-contrast proportions (${updatedAnswers.fit || 'tailored'}). Fits perfectly balanced for maximum aesthetic presence.\n\n🎯 VIBE DIRECTION:\nFrench streetwear and concrete minimalism aligned with ${updatedAnswers.vibe || 'Old Money'}.\n\n🧴 GROOMING & ADVICE:\nSince you are focusing heavily on ${updatedAnswers.lifestyle || 'yourself'}, your routine must be quick but high-end. No raw bar soaps! Use a dedicated salicylic cleanser and micro hydration routine.\n\nNow tell me - who do you want to secure first?`,
              timestamp: new Date()
            }
          ]);
          
          const supabase = getSupabase();
          if (supabase && userId) {
            supabase
              .from("profiles")
              .update({ is_premium: true })
              .eq("id", userId)
              .then(() => console.log("Admin premium persisted in Supabase"));
          }
        } else {
          // Activate paywall blur and modal
          setPaywallActive(true);
        }
      }
    } catch (err) {
      console.warn("AI onboarding fetch failed, using fallback:", err);
      setIsTyping(false);
      
      if (currentStage < 5) {
        const nextStageNum = currentStage + 1;
        setCurrentStage(nextStageNum);
        let tokyoQuestion = STAGE_QUESTIONS[nextStageNum];
        if (nextStageNum === 5) {
          tokyoQuestion = tokyoQuestion
            .replace("[Lifestyle]", updatedAnswers.lifestyle || "your Grind")
            .replace("[Vibe]", updatedAnswers.vibe || "the top Vibe");
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `tokyo_fallback_${Date.now()}`,
            role: "tokyo",
            content: `I love that answer! 😍 Let's proceed: ${tokyoQuestion}`,
            timestamp: new Date()
          }
        ]);
      } else {
        setPaywallActive(true);
      }
    }
  };

  const handlePayment = async () => {
    setPaymentSuccess(true);

    const supabase = getSupabase();
    if (supabase && userId) {
      try {
        await supabase
          .from("profiles")
          .update({
            is_premium: true,
            message_count: 5
          })
          .eq("id", userId);
        console.log("Supabase profile successfully updated to premium state.");
      } catch (dbErr) {
        console.error("Database update failed:", dbErr);
      }
    }

    setTimeout(async () => {
      // Simulate successful unlock state
      setPaywallActive(false);
      setIsOnboardingDone(true);
      setIsTyping(true);

      try {
        const response = await fetch("/api/tokyo/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            is_payment_hype: true,
            answers: answers,
            history: messages.map(m => ({ role: m.role, content: m.content })),
            is_test: false
          })
        });
        const data = await response.json();
        if (data.detected_gender) {
          setAnswers(prev => ({ ...prev, gender: data.detected_gender }));
        }
        const replyText = data.text || "OMGBESTIE! We are officially locked in! Thank you so much for trusting me, I promise I won't ever let you down! ❤️ Now, let's break the ice and start yapping. Tell me, how is your day REALLY going? Who has been annoying you today? Spill all the tea!";
        
        setMessages((prev) => [
          ...prev,
          {
            id: `tokyo_unlocked_${Date.now()}`,
            role: "tokyo",
            content: replyText,
            timestamp: new Date()
          }
        ]);
      } catch (err) {
        console.warn("Payment hype AI call failed, using fallback:", err);
        setMessages((prev) => [
          ...prev,
          {
            id: `tokyo_unlocked_fallback_${Date.now()}`,
            role: "tokyo",
            content: "OMGBESTIE! We are officially locked in! Thank you so much for trusting me, I promise I won't ever let you down! ❤️ Now, let's break the ice and start yapping. Tell me something juicy: what's the most chaotic thing that has happened to you this week? Let it all out!",
            timestamp: new Date()
          }
        ]);
      } finally {
        setIsTyping(false);
      }
    }, 1500);
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#696969] text-black overflow-hidden relative font-sans text-black">
      
      {/* HEADER BAR */}
      <header className="h-16 border-b border-slate-400/40 flex items-center justify-between px-4 md:px-10 shrink-0 bg-[#696969] z-10 select-none">
        <div className="flex items-center space-x-2 md:space-x-4">
          <div className={`w-2.5 h-2.5 rounded-full ${isTyping ? "bg-teal-800 animate-ping" : "bg-teal-900"}`} />
          <span className="text-xs md:text-sm font-black text-teal-950 tracking-tight">
            Tokyo - powered by Heist.
          </span>
          {superragStatus !== null && userEmail.toLowerCase().trim() === "shravan.p1877@gmail.com" && (
            <span className={`text-[10px] md:text-[11px] font-extrabold uppercase py-1 px-3 border rounded-xl shadow-xs transition duration-200 flex items-center gap-1.5 ${
              superragStatus.active_api
                ? "bg-emerald-100 border-emerald-400 text-emerald-800"
                : "bg-orange-50 border-orange-300 text-orange-700"
            }`}>
              🧠 SuperRAG: {superragStatus.active_api ? "Active API" : "Offline Fallback Cache"}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {/* Settings Tab / sign out */}
          <button 
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
            className="flex items-center space-x-1 px-3 py-1.5 border border-teal-950/25 bg-slate-100/90 rounded-xl text-teal-950 hover:bg-white active:scale-95 transition-all text-xs font-bold cursor-pointer shadow-sm"
          >
            <Settings size={13} />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* CHAT CONTAINER AREA */}
      <main className="flex-1 flex flex-col relative bg-[#696969] overflow-hidden">
        
        {/* CHAT SCREEN WITH TRANSITIONAL EFFECTS */}
        <div className={`flex-1 p-4 md:p-8 flex flex-col justify-between overflow-hidden relative ${paywallActive ? "backdrop-blur-md pointer-events-none select-none blur-sm" : ""}`}>
          <div className="flex-1 overflow-y-auto space-y-6 py-4 px-2 md:px-4">
            {showRestorePrompt && (
              <div className="bg-slate-100 border-2 border-slate-400 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 shadow-md animate-bounce-short">
                <div className="text-left">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-600">🧠 Tokyo remembers everything from previous chats.</p>
                  <p className="text-sm font-extrabold text-black">Restore your custom styling parameters seamlessly.</p>
                </div>
                <button
                  onClick={handleRestoreCloudSession}
                  disabled={isRestoring}
                  className="bg-[#525252] hover:bg-[#323232] text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50 shrink-0 shadow-sm"
                >
                  {isRestoring ? "Restoring..." : "Click here to restore"}
                </button>
              </div>
            )}

            {messages.map((msg, index) => (
              <div 
                key={`${msg.id}-${index}`}
                className={`max-w-[85%] md:max-w-[70%] flex flex-col ${msg.role === "user" ? "ml-auto" : ""}`}
              >
                <div className={`p-4 md:p-6 rounded-2xl shadow-sm ${
                  msg.role === "user" 
                    ? "bg-[#323232] text-white rounded-br-none"
                    : "bg-[#525252] text-white rounded-bl-none"
                }`}>
                  {msg.photo && (
                    <div className="mb-2 max-w-sm rounded-lg overflow-hidden border border-slate-600/50 bg-black/10">
                      <img 
                        src={msg.photo} 
                        alt="Styling context visual" 
                        referrerPolicy="no-referrer"
                        className="max-h-60 w-full object-cover rounded-lg"
                      />
                    </div>
                  )}
                  <p className="text-sm md:text-base leading-relaxed">
                    {msg.content}
                  </p>
                </div>
                <span className="text-[10px] text-black mt-1 uppercase tracking-widest px-1 font-mono font-bold select-none">
                  {msg.role === "tokyo" ? "Tokyo" : "Me"} • {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}

            {isTyping && (
              <div className="max-w-xs flex items-center space-x-2 bg-[#525252] p-4 rounded-2xl rounded-bl-none shadow-sm">
                <div id="typing-bubble" className="flex space-x-1.5">
                  <div className="w-2 h-2 bg-slate-200 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-slate-200 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-slate-200 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {!paywallActive && (
            <div className="pt-2">
              <AnimatePresence mode="wait">
                {currentStage === -2 && (
                  <motion.div
                    key="presets-stage-front"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="flex flex-wrap gap-2 pb-4 px-1"
                  >
                    <button
                      onClick={handleImageUploadClick}
                      className="py-3 px-5 bg-teal-950 text-white text-xs font-black border-2 border-teal-500 rounded-xl hover:bg-teal-900 active:scale-95 transition-all shadow-md cursor-pointer uppercase flex items-center space-x-2 animate-pulse"
                    >
                      <Image size={14} className="text-teal-400" />
                      <span>Upload Front Profile Photo 📸</span>
                    </button>
                  </motion.div>
                )}

                {currentStage === -1 && (
                  <motion.div
                    key="presets-stage-side"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="flex flex-wrap gap-2 pb-4 px-1"
                  >
                    <button
                      onClick={handleImageUploadClick}
                      className="py-3 px-5 bg-teal-950 text-white text-xs font-black border-2 border-teal-500 rounded-xl hover:bg-teal-900 active:scale-95 transition-all shadow-md cursor-pointer uppercase flex items-center space-x-2 animate-pulse"
                    >
                      <Image size={14} className="text-teal-400" />
                      <span>Upload Side Profile Photo 📸</span>
                    </button>
                  </motion.div>
                )}

                {STAGE_PRESETS[currentStage] && (
                  <motion.div
                    key={`presets-${currentStage}`}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="flex flex-wrap gap-2 pb-4 px-1"
                  >
                    {STAGE_PRESETS[currentStage].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handleUserAnswer(preset)}
                        className="py-2 px-3 bg-[#525252] text-white text-xs font-bold border border-slate-600 rounded-xl hover:bg-[#3d3d3d] active:scale-95 transition-all shadow-sm cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
 
              {/* Image Preview Thumbnail */}
              {selectedImage && (
                <div className="mb-2 px-1 flex items-center">
                  <div className="relative inline-block border-2 border-slate-400 bg-white rounded-xl overflow-hidden shadow-md p-1">
                    <img 
                      src={selectedImage} 
                      alt="Thumbnail upload preview" 
                      className="h-16 w-16 object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedImage(null)}
                      title="Remove image"
                      className="absolute top-0 right-0 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full transition active:scale-90 cursor-pointer text-[10px] w-5 h-5 flex items-center justify-center font-black"
                    >
                      <X size={10} />
                    </button>
                  </div>
                  <span className="text-xs text-black font-extrabold ml-3 animate-pulse bg-white border border-slate-400 px-3 py-1.5 rounded-xl shadow-sm uppercase tracking-wider select-none font-mono">
                    📸 Gemini Mode - Photo Attached
                  </span>
                </div>
              )}
 
              {/* LOWER INPUT CONTROL BOARD */}
              <div className="relative flex items-center px-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") handleUserAnswer(userInput);
                  }}
                  placeholder={
                    paywallActive 
                      ? "Master styling blueprints locking..." 
                      : currentStage === -2
                      ? "Attach front profile photo above... 📸"
                      : currentStage === -1
                      ? "Attach side profile photo above... 📸"
                      : "Type here to chat..."
                  }
                  disabled={paywallActive}
                  className="w-full bg-white text-black border-2 border-slate-400 py-4.5 pl-6 pr-32 rounded-2xl text-sm font-bold focus:outline-none placeholder-slate-500 duration-200 shadow-inner"
                />
                <div className="absolute right-4 flex space-x-2 items-center">
                  <button
                    type="button"
                    onClick={handleImageUploadClick}
                    disabled={paywallActive}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-800 p-2.5 rounded-xl border border-slate-300 transition duration-200 cursor-pointer flex items-center justify-center shadow-sm active:scale-95"
                    title="Upload Styling Photo / Aesthetic check"
                  >
                    <Image size={15} />
                  </button>
                  <button
                    disabled={(!userInput.trim() && !selectedImage) || paywallActive}
                    onClick={() => handleUserAnswer(userInput)}
                    className="bg-[#525252] hover:bg-[#323232] text-white p-2.5 rounded-xl transition-all duration-200 disabled:opacity-40 cursor-pointer"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TASK 3: THE PREMIUM PAYWALL BOTTOM SHEET MODAL (SLIDE UP) */}
        <AnimatePresence>
          {paywallActive && (
            <div id="paywall-wrapper" className="absolute inset-0 bg-slate-900/60 z-50 flex items-end justify-center backdrop-blur-sm">
              <motion.div 
                initial={{ y: "100%", opacity: 0.8 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "100%", opacity: 0.8 }}
                transition={{ type: "spring", damping: 25, stiffness: 180 }}
                className="w-full max-w-lg bg-white border-t-4 border-l-2 border-r-2 border-[#525252] rounded-t-[2.5rem] p-6 md:p-10 shadow-2xl space-y-6 relative pb-10 text-black"
              >
                {/* Visual Puller Bar */}
                <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto mb-2" />

                <div className="text-center space-y-3">
                  <div className="mx-auto w-12 h-12 bg-slate-150 rounded-full flex items-center justify-center text-teal-950">
                    <Lock size={20} />
                  </div>
                  
                  <h3 className="text-2xl md:text-3xl font-black text-slate-900 uppercase">
                    Style DNA Locked
                  </h3>
                  
                  <p className="text-xs md:text-sm text-slate-700 font-semibold px-4 leading-relaxed">
                    Tokyo has analyzed your aesthetics, customized your tailored <span className="font-bold underline text-teal-950">{answers.fit}</span> parameters, and formulated concrete neutral coordinates. Elevate your presence 24/7.
                  </p>
                </div>

                <div className="bg-slate-100 p-4 rounded-3xl border border-slate-250 text-center space-y-1">
                  <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Tokyo Luxury Plan</p>
                  <p className="text-3xl font-black text-teal-950">₹149</p>
                  <p className="text-[11px] font-medium text-slate-600 italic">
                    Cost is less than 4 Diet Cokes. ₹389/month after.
                  </p>
                </div>

                <div className="space-y-2.5 text-xs text-slate-700 max-w-sm mx-auto py-2 font-semibold">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 size={14} className="text-teal-900 shrink-0" />
                    <span>Your Custom style coordinates playbook</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 size={14} className="text-teal-900 shrink-0" />
                    <span>Instant color combinations based on {answers.vibe}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 size={14} className="text-teal-900 shrink-0" />
                    <span>Grooming & clean routine tracker (No bar soaps!)</span>
                  </div>
                </div>

                {paymentSuccess ? (
                  <div className="bg-emerald-50 border border-emerald-300 p-4 rounded-2xl text-emerald-800 text-center flex items-center justify-center space-x-2">
                    <CheckCircle2 size={18} className="animate-pulse" />
                    <span className="font-black uppercase tracking-wider text-[11px]">Payment Approved! Style blueprint unlocked ✨</span>
                  </div>
                ) : (
                  <button
                    onClick={handlePayment}
                    className="w-full py-4 bg-teal-950 hover:bg-teal-900 text-white font-extrabold text-xs tracking-widest uppercase rounded-2xl transition-all duration-200 active:scale-[0.98] shadow-lg cursor-pointer"
                  >
                    Unlock Now - ₹149
                  </button>
                )}

                <div className="text-center">
                  <button 
                    onClick={onLogout}
                    className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:underline hover:text-slate-700 cursor-pointer"
                  >
                    Cancel & exit onboarding
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Overlay Drawer */}
      <AnimatePresence>
        {showSettings && (
          <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-md border-2 border-[#525252] text-black space-y-6 shadow-2xl relative"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                <div className="flex items-center space-x-2">
                  <Settings size={18} className="text-teal-950" />
                  <h3 className="text-md font-black uppercase tracking-wider text-slate-900">Settings</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-1 px-2.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-800 cursor-pointer"
                >
                  Close
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-extrabold">Active Account</p>
                <div className="text-sm font-semibold truncate text-slate-800 font-mono bg-slate-100 p-3 rounded-xl border border-slate-200">
                  {userEmail}
                </div>
              </div>

              <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs text-slate-600 leading-relaxed">
                <p className="font-extrabold uppercase text-[9px] text-slate-500 tracking-wider">Device & Security</p>
                <p>Status: connected secures</p>
                <p>Protocol: Supabase State persistence active</p>
              </div>

              <div className="space-y-2 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs text-left">
                <p className="font-extrabold uppercase text-[9px] text-slate-500 tracking-wider">Policies & Compliance</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false);
                    window.history.pushState({}, "", "/legal");
                    window.dispatchEvent(new Event("heist-navigate"));
                  }}
                  className="w-full text-left font-bold text-teal-850 hover:underline cursor-pointer flex items-center space-x-1.5"
                >
                  <span>⚖️ view HEIST. legal agreements</span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    setShowSettings(false);
                    onLogout();
                  }}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs tracking-widest uppercase py-4 rounded-xl transition duration-150 shadow-md text-center flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <LogOut size={14} />
                  <span>Sign Out / Log Out</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}