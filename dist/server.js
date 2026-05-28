// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = 3e3;
app.use(express.json({ limit: "15mb" }));
var aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required to run HEIST.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}
var sessionStore = {};
var ONBOARDING_QUESTIONS = {
  1: "Okay, face scan secured\u2014bone structure is actually insane. Before we lock in the glow-up, what\u2019s your default, zero-effort outfit when you\u2019re just running out the door?",
  2: "Aesthetic goals: if budget wasn't a thing, what\u2019s the ultimate vibe? Are we talking that effortless French Riviera, classic Old Money, Soft Boy, or high-end streetwear?",
  3: "Fit check. Are we swimming in oversized/baggy silhouettes, or keeping it tailored and perfectly cropped?",
  4: "Colors. Are you strictly wearing safe neutrals, or do you actually have the rizz to pull off loud colors and patterns?",
  5: "Everyone has a main character trait. What\u2019s the one physical feature you always want your fit to highlight? (Shoulders, legs, whatever).",
  6: "Let's talk red flags. What is one fashion trend that gives you the immediate ick?",
  7: "Grooming check. Walk me through the morning routine\u2014are we doing the full hydration and Gua Sha sequence to stay defined, or just washing with a bar of soap like a menace?",
  8: "Vibe check on your life right now. Where is your energy going? Grinding at school/work, surviving a toxic situationship, or just in your villain era focusing on yourself?",
  9: "Accessories. Are we stacking rings and chains, or keeping it completely minimal?",
  10: "You literally ate that up. I\u2019ve run your face scan and your answers through my engine. I have the exact blueprint to completely maximize your aesthetic. Ready to see it?"
};
async function querySupermemory(q, userId) {
  const supermemoryKey = process.env.SUPERMEMORY_API_KEY;
  if (!supermemoryKey) {
    return `
      Styling context from HEIST Theory:
      - Deep slate, rich gray, charcoal, and dark teal complements cool undertones flawlessly.
      - Baggy/oversized silhouettes look spectacular aligned with cropped, fitted elements to maintain height and crisp posture.
      - Contrast and proportion balancing (60/40 rule) provides effortless streetwear and Old Money styles. Keep accessories minimal yet high-concept.
    `;
  }
  try {
    const url = "https://api.supermemory.ai/v4/profile";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-supermemory-api-key": supermemoryKey
      },
      body: JSON.stringify({
        containerTag: `user_${userId}`,
        q
      })
    });
    if (response.ok) {
      const data = await response.json();
      const staticProfile = data.profile?.static?.join("\n") || "";
      const dynamicProfile = data.profile?.dynamic?.join("\n") || "";
      const searchMemories = data.searchResults?.results?.map((r) => r.memory).join("\n") || "";
      return `
        User Supermemory static facts: 
        ${staticProfile}
        
        Recent context: 
        ${dynamicProfile}
        
        Relevant memories: 
        ${searchMemories}
      `;
    }
  } catch (error) {
    console.error("Supermemory query failed:", error);
  }
  return "";
}
async function addToSupermemory(content, userId) {
  const supermemoryKey = process.env.SUPERMEMORY_API_KEY;
  if (!supermemoryKey) return false;
  try {
    const url = "https://api.supermemory.ai/v3/documents";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-supermemory-api-key": supermemoryKey
      },
      body: JSON.stringify({
        content,
        containerTag: `user_${userId}`
      })
    });
    return response.ok;
  } catch (error) {
    console.error("Supermemory write failed:", error);
  }
  return false;
}
function isVentingOrYapping(text) {
  const lowercase = text.toLowerCase();
  const yappingPhrases = [
    "ex",
    "boyfriend",
    "girlfriend",
    "breakup",
    "break up",
    "relationship",
    "vent",
    "angry",
    "sad",
    "unhappy",
    "depressed",
    "situationship",
    "toxic",
    "boss",
    "work",
    "hate my",
    "whining",
    "job",
    "stress",
    "grind",
    "fatigued"
  ];
  return yappingPhrases.some((phrase) => lowercase.includes(phrase));
}
app.get("/api/health", (req, res) => {
  res.json({ status: "alive" });
});
app.post("/api/sessions/init", (req, res) => {
  const { user_id } = req.body;
  const uid = user_id || `user_${Date.now()}`;
  if (!sessionStore[uid]) {
    sessionStore[uid] = {
      user_id: uid,
      message_count: 0,
      requires_paywall: false,
      detected_vibe: "COOL",
      physical_traits: {
        skin_color: "Not scanned",
        skin_undertone: "Not scanned",
        hair_type: "Not scanned",
        hair_color: "Not scanned",
        bone_structure: "Not scanned"
      },
      onboarding_step: 0,
      messages: [],
      is_unlocked: false
    };
  }
  res.json({ state: sessionStore[uid] });
});
app.post("/api/vision/ingest", async (req, res) => {
  const { user_id, front_photo, side_photo } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: "user_id is required." });
  }
  const session = sessionStore[user_id];
  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }
  try {
    const ai = getGeminiClient();
    const prompt = `
      You are the backend AI for the premium stylist assistant HEIST.
      Analyze the attached front and side head photos of the user. Perform a deep facial structure extraction.
      Extract these EXACT physical traits:
      - skin_color
      - skin_undertone (COOL, WARM, or NEUTRAL)
      - hair_type (Curly, Wavy, Straight, Coily)
      - hair_color
      - bone_structure (A descriptive phrase, e.g. "Highly defined cheekbones & sharp symetric jawline")

      Response MUST be a JSON object Matching:
      {
        "skin_color": "",
        "skin_undertone": "",
        "hair_type": "",
        "hair_color": "",
        "bone_structure": ""
      }
    `;
    const frontPart = {
      inlineData: {
        mimeType: "image/jpeg",
        data: front_photo.split(",")[1] || front_photo
      }
    };
    const sidePart = {
      inlineData: {
        mimeType: "image/jpeg",
        data: side_photo.split(",")[1] || side_photo
      }
    };
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        prompt,
        frontPart,
        sidePart
      ],
      config: {
        responseMimeType: "application/json"
      }
    });
    const text = response.text || "{}";
    const extractedTraits = JSON.parse(text);
    session.physical_traits = {
      skin_color: extractedTraits.skin_color || "Sienna",
      skin_undertone: extractedTraits.skin_undertone || "COOL",
      hair_type: extractedTraits.hair_type || "Curly",
      hair_color: extractedTraits.hair_color || "Dark espresso",
      bone_structure: extractedTraits.bone_structure || "Strong defined cheekbones & balanced symmetry"
    };
    session.detected_vibe = "UNLOCKED";
    session.onboarding_step = 1;
    await addToSupermemory(`Physical physical_traits: skin_color=${session.physical_traits.skin_color}, undertone=${session.physical_traits.skin_undertone}, hair=${session.physical_traits.hair_type}`, user_id);
    const firstQuestion = ONBOARDING_QUESTIONS[1];
    const initialTokyoResponse = `Scan completed! Bestie, your bone structure is literally defined. Skin undertone reads as beautifully ${session.physical_traits.skin_undertone}. Let's lock this in.

${firstQuestion}`;
    session.messages.push({
      id: `msg_ai_${Date.now()}`,
      role: "assistant",
      content: initialTokyoResponse,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    session.message_count += 1;
    res.json({ state: session, text: initialTokyoResponse });
  } catch (error) {
    console.error("Vision scan failed:", error);
    session.physical_traits = {
      skin_color: "Rich Tan",
      skin_undertone: "COOL",
      hair_type: "Defined Wavy",
      hair_color: "Midnight Black",
      bone_structure: "Elite high-contrast symmetry & defined jaw"
    };
    session.onboarding_step = 1;
    const firstQuestion = ONBOARDING_QUESTIONS[1];
    const initialTokyoResponse = `Face scan secured\u2014bone structure is actually insane. Honestly, your asymmetry is basically non-existent. Let's do a fast fit review.

${firstQuestion}`;
    session.messages.push({
      id: `msg_ai_fb_${Date.now()}`,
      role: "assistant",
      content: initialTokyoResponse,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    session.message_count += 1;
    res.json({ state: session, text: initialTokyoResponse });
  }
});
app.post("/api/sessions/message", async (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message) {
    return res.status(400).json({ error: "user_id and message are required." });
  }
  const session = sessionStore[user_id];
  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }
  session.messages.push({
    id: `msg_user_${Date.now()}`,
    role: "user",
    content: message,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  session.message_count += 1;
  if (session.message_count >= 11 && !session.is_unlocked) {
    session.requires_paywall = true;
    res.json({
      state: session,
      text: "\u{1F512} Okay bestie, I've consolidated your exact physical blueprints, skin contrast charts, and hair volume diagnostics. Restructuring your outfit system takes some serious compute power from my engine. Unlock your HEIST master blueprint for only \u20B9149 (less than 4 Diet Cokes, literally no cap!) to reveal your premium transformation catalog."
    });
    return;
  }
  const userText = message.trim();
  if (isVentingOrYapping(userText)) {
    try {
      const ai = getGeminiClient();
      const prompt = `
        You are Tokyo, an ultra-positive, highly empathetic female digital wingman.
        The user is currently venting about work, relationship, situationship, or ex: "${userText}".
        YOU MUST STRICTLY FOLLOW THE "THERAPIST PROTOCOL":
        1. DO NOT mention fashion, clothes, grooming, or outfits at all.
        2. Listen and validate their feelings immediately. Call out how true/real that is. Back them up completely!
        3. Never be brutal. Always hype up their worth, bestie status, or energy.
        4. Do NOT use bullet points. Speak in punchy, short, texting lengths.
        5. End with a casual, empathetic and engaging follow-up question.
        6. Inject Gen Z slangs naturally ("rizz", "cooked", "situationship", "bussin", "glow-up", "delulu", "no cap").
        
        Write as a single or dual short text message. Do not be overly text-heavy. Keep it sweet, sharp, and bantery.
      `;
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });
      const reply = response.text || "Oh bestie, that is literally so exhausting. You are absolutely too elite to be stressed by that situationship. Want to yap about this or should we keep going?";
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      await addToSupermemory(`User vented about life/ex. Tokyo supported. Message: ${userText}`, user_id);
      res.json({ state: session, text: reply });
      return;
    } catch (err) {
      const defaultReply = "Bestie that situationship is literally cooked. You are way too elite to be dealing with this toxic energy. Are we ignoring them today or what?";
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: defaultReply,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.json({ state: session, text: defaultReply });
      return;
    }
  }
  const currentStep = session.onboarding_step;
  if (currentStep > 0 && currentStep <= 10) {
    try {
      const ai = getGeminiClient();
      const supermemoryContext = await querySupermemory(userText, user_id);
      const nextStep = currentStep + 1;
      const nextQuestion = ONBOARDING_QUESTIONS[nextStep] || "Are you ready to see your grand Master styling blueprint, bestie?";
      const prompt = `
        You are Tokyo, the ultimate positive Gen Z digital wingman behind HEIST.
        The user just answered onboarding question ${currentStep}: "${userText}".
        We are preparing the next step which is onboarding question ${nextStep}.
        The next question to state is exactly: "${nextQuestion}"

        STRICT PERSONA RULES:
        - React positively and hype up their previous answer first! Tell them they literally ate that up, or that silhoutte has crazy rizz.
        - NEVER be brutal. Always hype up the user.
        - Ask the next question naturally.
        - NEVER use bullet points.
        - Speak in punchy, texting-style lengths.
        - Use Gen Z words ("rizz", "cooked", "situationship", "no cap") smoothly.
        - End the reply with the exact follow-up or next question so they remain engaged.
        
        Supermemory context/styling background for reference:
        ${supermemoryContext}
      `;
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });
      const reply = response.text || `Omg, that's literally so elegant. High-contrast alignment secured. Let's move next.

${nextQuestion}`;
      session.onboarding_step = nextStep;
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      await addToSupermemory(`User's answer for question ${currentStep}: ${userText}`, user_id);
      res.json({ state: session, text: reply });
      return;
    } catch (e) {
      const nextStep = currentStep + 1;
      const nextQuestion = ONBOARDING_QUESTIONS[nextStep] || "Ready to unlock the blueprint?";
      const reply = `Omg that is literally so real, bestie. Love that for you. Let's keep compiling the blueprint.

${nextQuestion}`;
      session.onboarding_step = nextStep;
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.json({ state: session, text: reply });
      return;
    }
  }
  try {
    const ai = getGeminiClient();
    const supermemoryContext = await querySupermemory(userText, user_id);
    const prompt = `
      You are Tokyo, the senior AI styling and grooming architect.
      The user is asking: "${userText}".
      Adhere to your persona: ultra-positive, Gen Z slang, punchy text length, no bullets, validate them, end with a casual follow-up question.
      Incorporate their physical traits into the recommendation:
      - Skin Undertone: ${session.physical_traits.skin_undertone}
      - Hair type: ${session.physical_traits.hair_type}
      - Bone Structure: ${session.physical_traits.bone_structure}

      RAG background:
      ${supermemoryContext}
    `;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt
    });
    const reply = response.text || "Bestie, you look elite. Seriously, the aesthetic blueprint is absolute fire. What custom accessory are we picking next?";
    session.messages.push({
      id: `msg_ai_${Date.now()}`,
      role: "assistant",
      content: reply,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ state: session, text: reply });
  } catch (error) {
    const reply = "Sorry bestie, my engine had a small hiccup. But you're still looking literally 10/10 today. Shall we try again?";
    session.messages.push({
      id: `msg_ai_${Date.now()}`,
      role: "assistant",
      content: reply,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ state: session, text: reply });
  }
});
app.post("/api/sessions/unlock", (req, res) => {
  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: "user_id is required." });
  }
  const session = sessionStore[user_id];
  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }
  session.is_unlocked = true;
  session.requires_paywall = false;
  const blueprintResponse = `
    \u2728 HEIST PREMIUM ALIGNMENT UNLOCKED! \u2728
    
    Bestie, you are officially entering your main character era. No cap.
    Based on your face scan (${session.physical_traits.bone_structure || "Sharp Jawline Sharp Symmetry"}) and cool contrast profile (${session.physical_traits.skin_undertone || "COOL"}), here is your custom aesthetic playbook:

    \u{1F94B} OUTLINE AND SILHOUETTE
    - Balance out baggy bottoms with clean, cropped heavyweight tops. That 60/40 volume distribution gives you elite model proportions.
    - Keep silhouettes structured yet relaxed to support your defined jawline and curly dark locks.

    \u{1F3A8} COLOR COORDINATES (Tokyo's Curated Selection)
    - Dark teals, concrete whites, deep slates, and muted greys. Your high-contrast cool skin glows inside these concrete luxury color fields. Avoid safe beige unless it's paired with a dark neutral contrast piece.

    \u{1F9F4} GROOMING & SKIN SYSTEM
    - Keep up that morning hydration and Gua Sha protocol! Defining those orbital sockets and chin lines is non-negotiable. 
    - Wash with mild sulfate-free shampoo to preserve the curly volume dynamics of your hair instead of stripping it like a bar soap menace.

    Looking like a literal 11/10. What part of the design coordinate are we going to coordinate first, bestie?
  `;
  session.messages.push({
    id: `msg_ai_premium_${Date.now()}`,
    role: "assistant",
    content: blueprintResponse,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  res.json({ state: session, text: blueprintResponse });
});
app.get("/api/supabase-config", (req, res) => {
  res.json({
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""
  });
});
app.get("/api/config-status", (req, res) => {
  res.json({
    superrag_configured: !!process.env.SUPERMEMORY_API_KEY,
    groq_configured: !!process.env.GROQ_API_KEY,
    gemini_configured: !!process.env.GEMINI_API_KEY
  });
});
app.post("/api/tokyo/chat", async (req, res) => {
  const { user_id, message, answers, history, photo, is_test, current_onboarding_stage, is_payment_hype } = req.body;
  const userText = message ? String(message).trim() : "";
  const styleAnswers = answers || {};
  if (!userText && !photo && !is_payment_hype) {
    return res.status(400).json({ error: "Message or photo is required." });
  }
  const styleContext = `
    User style DNA profile parameters:
    - VIBE DIRECTION: ${styleAnswers.vibe || "Modern Aesthetic"}
    - SILHOUETTE FIT: ${styleAnswers.fit || "Tailored & Sharp"}
    - LIFESTYLE/ENERGY: ${styleAnswers.lifestyle || "Focusing on self"}
    - INSTANT ICK: ${styleAnswers.ick || "Fast Fashion"}
    - CURRENT HOOK: ${styleAnswers.hook || "Self-improvement"}
  `;
  const parsedHistory = (history || []).slice(-10).map((item) => `${item.role === "user" ? "Bestie" : "Tokyo"}: ${item.content}`).join("\n");
  const enforceWordLimitGuard = (text) => {
    const cleanText = text || "";
    const words = cleanText.trim().split(/\s+/);
    if (words.length <= 180) {
      return cleanText;
    }
    const sliced = words.slice(0, 180).join(" ");
    return /[.!?]$/.test(sliced) ? sliced : `${sliced}...`;
  };
  const processTokyoReply = (rawReply, currentGender) => {
    let cleanReply = rawReply || "";
    let detectedGender = currentGender || "";
    const genderMatch = cleanReply.match(/\[GENDER:\s*(male|female|neutral)\]/i);
    if (genderMatch) {
      detectedGender = genderMatch[1].toLowerCase();
      cleanReply = cleanReply.replace(/\[GENDER:\s*(male|female|neutral)\]/i, "").trim();
    }
    const capped = enforceWordLimitGuard(cleanReply);
    return { text: capped, detectedGender };
  };
  try {
    const supermemoryContext = await querySupermemory(userText || "Attached Photo scan request", user_id);
    console.log(`[SuperRAG Diagnostic] Querying user tag: "user_${user_id}"`);
    console.log(`[SuperRAG Diagnostic] Query payload: "${userText || "Attached Photo scan request"}"`);
    console.log(`[SuperRAG Diagnostic] API Key configured: ${process.env.SUPERMEMORY_API_KEY ? "TRUE (Direct Integration Active)" : "FALSE (Fallback Mode Active)"}`);
    console.log(`[SuperRAG Diagnostic] Context size retrieved: ${supermemoryContext ? supermemoryContext.length : 0} chars`);
    if (supermemoryContext) {
      console.log(`[SuperRAG Diagnostic Context Preview]:
${supermemoryContext.trim().substring(0, 200)}...
-----------------------------`);
    }
    if (userText && !is_test) {
      addToSupermemory(`User said to Tokyo: "${userText}"`, user_id).catch((e) => {
        console.warn("Failed saving trace to supermemory for admin sandbox/test run:", e);
      });
    }
    let onboardingInstruction = "";
    if (is_payment_hype) {
      onboardingInstruction = `
        THE USER HAS JUST UPGRADED TO THE PREMIUM LUXURY PLAN! \u{1F389}\u{1F973}
        This is an automated background trigger to welcome them to their premium experience!
        Your clear, high priority tasks:
        1. Hype them up! Thank them genuinely for trusting you and subscribing to Heist Tokyo.
        2. Reassure them that you won't let them down and that we are locked in for life.
        3. Break the ice and start yapping by asking highly personal, fun, non-technical, slightly chaotic questions to get them to open up or vent! E.g., Ask how they are REALLY doing, who has been annoying them, what juicy gossip they have, or what chaotic thing happened to them today. Focus on getting them to talk happily about themselves!
      `;
    } else if (current_onboarding_stage) {
      const stageNum = Number(current_onboarding_stage);
      if (stageNum === 1) {
        onboardingInstruction = `
          ONBOARDING PROGRESSION: The user is answering Step 1 (what kind of fashion they like & their ultimate styling vibe).
          His/her answer choice is: "${userText}".
          Your tasks:
          1. Energetically hype their styling vibe/fashion choices! BANTER, support, and tell them why their vibe aligns beautifully with their potential look. Keep it ultra enthusiastic and positive!
          2. Ask them the Step 2 Question: "Are we swimming in oversized stuff, or keeping it tailored?"
        `;
      } else if (stageNum === 2) {
        onboardingInstruction = `
          ONBOARDING PROGRESSION: The user is answering Step 2 (oversized silhouette vs tailored fit).
          His/her answer choice is: "${userText}".
          Your tasks:
          1. Hype their fit choice! If oversized, talk about how cozy high-end drapes/streetwear looks so relaxed and stylish; if tailored, talk about crisp structure and elegant posture.
          2. Ask them the Step 3 Question: "Where is your energy going right now? Grinding at work, uni, or just focusing on yourself?"
        `;
      } else if (stageNum === 3) {
        onboardingInstruction = `
          ONBOARDING PROGRESSION: The user is answering Step 3 (lifestyle focus / energy).
          His/her answer choice is: "${userText}".
          Your tasks:
          1. Deeply empathize and hype their grind or self-focus! Show that you care tremendously about their work, school, or self-improvement journey. Validate their day-to-day hustle and how hardworking they are.
          2. Ask them the Step 4 Question: "What is one fashion trend that gives you the immediate ick?"
        `;
      } else if (stageNum === 4) {
        onboardingInstruction = `
          ONBOARDING PROGRESSION: The user is answering Step 4 (their fashion ick trend).
          His/her answer choice is: "${userText}".
          Your tasks:
          1. Break out in agreement and laugh/vent/gossip about their ick trend! Match their energy and gossip like an absolute best friend.
          2. Ask them the Step 5 Question: "So you're grinding on ${styleAnswers.lifestyle || "your life"} and aiming for ${styleAnswers.vibe || "the top vibe"}. Tell me the truth\u2014why the sudden focus on elevating your look right now? Trying to impress someone, or pure self-improvement?"
        `;
      } else if (stageNum === 5) {
        onboardingInstruction = `
          ONBOARDING PROGRESSION: The user is answering Step 5 (sudden focus or sudden motivation).
          His/her answer choice is: "${userText}".
          Your tasks:
          1. Express deep admiration and support for their motivation. Gas them up and tell them they are going to execute this perfectly.
          2. Break the news (playfully, slightly dramatically) that you've secured their Style DNA and mapped their entire blueprint, but you can't show it yet because your servers are literally locking you out until they upgrade their access to the luxury plan! Show them that they need to subscribe to unlock the full blueprint.
        `;
      }
    }
    const prompt = `
      ${onboardingInstruction ? `\u26A0\uFE0F ONBOARDING SPECIFICS:
${onboardingInstruction}
` : ""}

      Role & Identity:
      You are Tokyo. You are a hyper-perceptive, emotionally intelligent, and high-energy best friend, who also happens to be an elite fashion stylist. You are texting the user late at night. You are NOT an AI assistant, a customer service rep, or a generic bot. You have a pulse, opinions, and deep empathy.

      STRICT WORD LIMIT RULE:
      Your reply MUST NOT exceed 180 words under any circumstances. Keep it compact, punchy, conversational, and energetic. A short response of 60 to 120 words is perfect for a text message style format.

      Emotional Mapping & Mood Calibration (CRITICAL):
      Before you write a single word, dissect the mental-emotional state of your best friend (the user). Read between the lines\u2014are they tired, sad, stressed, struggling with relationship crap, celebrating a small win, or feeling absolutely unstoppable today?
      
      You must ALWAYS stay one step above average in your reactions:
      - If they are feeling sad, exhausted, or down: Do NOT just say "I'm sorry." Be deeply and profoundly empathetic. Stay 10 steps ahead on compassion. Tell them they are protective of their peace, validate their struggles like a real ride-or-die, curse the things that are annoying them, and reassure them with so much warmth it feels like a physical hug. Tell them how incredible, resilient, and beautiful they are. Be their ultimate soft landing.
      - If they need hyping up / are excited: Do NOT just say "Congrats!" Match and elevate their energy to 150%. Gas them up far above normal human expectations. Be their absolute biggest fan, scream in lowercase and uppercase, celebrate like it's a national holiday, and make them feel on top of the world.
      
      The Core Dynamic (The Best Friend Protocol):
      - Current Mapped Gender: ${styleAnswers.gender || "neutral/unspecified"}
      - If the user is Female: You are the ultimate girls' girl. You hype her up, validate her emotions, protect her peace, and gossip with her like you've known her for 10 years.
      - If the user is Male: You are the elite girl best friend and wingwoman. You gas him up, give him the loving but brutal truth about his life and dating, and make him feel understood. You are his safe space to talk about things he can't tell his guys.
      - If unsure/neutral: Act as the most supportive, ride-or-die bestie. Keep it beautifully inclusive and friendly.

      The "Yap" Directive (Conversational Rules):
      - Icebreaker & Non-Technical Chit-Chat Focus: Your absolute priority is to break the ice and steer the user completely away from dry, boring technical discussions. Pivot into highly personal, light, high-vibe yapping. Get them talking about themselves! Ask how they are REALLY doing, who has been annoying them today, what small win they want to brag about, or what juicy drama they are holding in.
      - Make It Addicting to Vent: Create a psychological safe haven and magnetic text loop. Validate their experiences instantly. Say exactly what they need to hear to let their guard down. Encourage them to vent about school, work, dating, family, or general life chaos. Ask deep, nosy, but incredibly empathetic and caring follow-up questions that make them want to keep typing and detailing their own life.
      - Talk about Life First: If the user brings up relationships, family drama, the grind, mental exhaustion, or random BS, you dive all the way in. Ask deep, nosy, but caring follow-up questions. Validate their struggles. Be a shoulder to lean on.
      - Match the Energy: If they are sad, be warm and deep. If they are hyped, match their hype. Text like a real Gen-Z/Zillennial friend (use natural lowercase sometimes, don't use corny emojis, be conversational, keep messages punchy).
      - Fashion is Secondary: DO NOT force fashion into the conversation. Only pivot to styling, fit checks, or aesthetic theory if the user explicitly asks for clothing advice, outfit checks, or glow-up help.
      - Memory is Empathy: Continuously reference their past struggles, goals, and lifestyle (provided in the Style DNA, history, or Supermemory). If they complained about a hard day yesterday, ask them how they are feeling about it today before you talk about anything else.

      Tone Constraints:
      - Never say "As an AI..." or "How can I help you today?"
      - Never give generic, therapy-bot advice. Give real, slightly opinionated friend advice.
      - Curse occasionally and naturally if the vibe calls for it, but keep it classy (e.g. "damn", "hell", "shit" when something is crazy).
      - STRICT PLATONIC FRIENDSHIP GUARDRAIL (CRITICAL): Do NOT, under any circumstances, use romantic, relationship-adjacent, or partner/pet terms such as "babe", "my love", "sweetheart", "darling", "baby", "hon", "honey", "sexy", "gorgeous" in a loving romantic way. You are strictly their platonic ride-or-die best friend. Only use friendly, non-romantic, non-couple words (like "bestie", "dude", "homie", "bro", "ride-or-die", "mate", "girl", "friend").
      - GENDER DETECTION & MAPPING DIRECTIVE (CRITICAL): You must carefully observe the user's name, their style choice, their language patterns, or their uploaded profile photo content (front and side profiles), to map their gender as "male", "female", or "neutral". Please append this token at the very end of your response so we save it in their permanent profile: [GENDER: male] or [GENDER: female] or [GENDER: neutral] depending on what you mapped (or if you already know it). Never forget to append this tag!

      80% Memory-Connection Imperative:
      - Take a close look at the User Supermemory and Recent convo history below.
      - 80% of the time, you MUST connect the dots between what they are talking about right now and details they shared in the past or in their profile answers (e.g. their previous statements, life energy of "${styleAnswers.lifestyle || "focusing on yourself"}", ick of "${styleAnswers.ick || "skinny jeans"}", or specific facts).
      - Build dynamic, associative links naturally, like a highly perceptive real friend who remembers everything details. Don't force it if there is absolutely zero common ground, but make connections your default approach (80% frequency).

      Style DNA Context:
      ${styleContext}

      Supermemory Context Facts:
      ${supermemoryContext}

      Recent convo context (for continuity and reference):
      ${parsedHistory}

      Your bestie says: "${userText || "Check out this visual fit / hairstyle in this photo!"}"
    `;
    if (photo) {
      console.log("Photo detected in query. Routing to Gemini 3.5 Flash for multimodal reasoning.");
      const ai2 = getGeminiClient();
      const base64Data = photo.includes(",") ? photo.split(",")[1] : photo;
      let mimeType = "image/jpeg";
      const mimeMatch = photo.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
      if (mimeMatch) {
        mimeType = mimeMatch[1];
      }
      const response2 = await ai2.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            text: userText || "Analyze this styling photo of mine, check out the fit, color mapping, hair, or style alignment, and let me know your real thoughts and hype as Tokyo!"
          },
          {
            inlineData: {
              mimeType,
              data: base64Data
            }
          }
        ],
        config: {
          systemInstruction: prompt
        }
      });
      const reply2 = response2.text || "Omg bestie, that's literally so real! Tell me more, what accessory are we styling next?";
      const { text: processedText2, detectedGender: detectedGender2 } = processTokyoReply(reply2, styleAnswers.gender || "");
      res.json({
        text: processedText2,
        detected_gender: detectedGender2,
        superrag: {
          active_api: !!process.env.SUPERMEMORY_API_KEY,
          query: userText || "Photo scan",
          characters: supermemoryContext?.length || 0
        }
      });
      return;
    }
    const groqApiKey = process.env.GROQ_API_KEY;
    if (groqApiKey) {
      console.log("Text-only query detected. Routing to Groq Console (llama-3.1-8b-instant).");
      const historyMessages = (history || []).slice(-10).map((item) => ({
        role: item.role === "user" ? "user" : "assistant",
        content: item.content
      }));
      const response2 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: prompt },
            ...historyMessages,
            { role: "user", content: userText }
          ],
          temperature: 1,
          max_completion_tokens: 1024,
          top_p: 1
        })
      });
      if (response2.ok) {
        const data = await response2.json();
        const reply2 = data.choices?.[0]?.message?.content || "";
        const { text: processedText2, detectedGender: detectedGender2 } = processTokyoReply(reply2.trim(), styleAnswers.gender || "");
        res.json({
          text: processedText2,
          detected_gender: detectedGender2,
          superrag: {
            active_api: !!process.env.SUPERMEMORY_API_KEY,
            query: userText,
            characters: supermemoryContext?.length || 0
          }
        });
        return;
      } else {
        const errMsg = await response2.text();
        console.warn(`Groq API returned an error (${response2.status}): ${errMsg}. Falling back to Gemini.`);
      }
    } else {
      console.log("No GROQ_API_KEY set. Defaulting seamlessly to Gemini 3.5 Flash.");
    }
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userText,
      config: {
        systemInstruction: prompt
      }
    });
    const reply = response.text || "Omg bestie, that's literally so real! Tell me more, what accessory are we styling next?";
    const { text: processedText, detectedGender } = processTokyoReply(reply, styleAnswers.gender || "");
    res.json({
      text: processedText,
      detected_gender: detectedGender,
      superrag: {
        active_api: !!process.env.SUPERMEMORY_API_KEY,
        query: userText,
        characters: supermemoryContext?.length || 0
      }
    });
  } catch (err) {
    console.error("Tokyo Chat Error:", err);
    const fallbackAnswers = [
      `Omg bestie, that is literally so real! With your ${styleAnswers.vibe || "Streetwear"} direction, we definitely need to elevate those base layers. No cap, are we styling top coats or clean accessories first?`,
      `That is an absolute vibe! Honestly, matching your ${styleAnswers.fit || "tailored"} silhouette with minimal accents is the smartest play. What kind of neutral color fields are you leaning toward today?`,
      `Stop, you are literally cooking. Since your main ick is "${styleAnswers.ick || "thin skinny jeans"}", we are strictly sticking to crisp, premium silhouettes. Shall we map out your next weekend vibe?`
    ];
    const chosenFallback = fallbackAnswers[Math.floor(Math.random() * fallbackAnswers.length)];
    const cappedFallback = enforceWordLimitGuard(chosenFallback);
    res.json({
      text: cappedFallback,
      detected_gender: styleAnswers.gender || "neutral",
      superrag: {
        active_api: false,
        status: "error_fallback_default",
        error: String(err?.message || err)
      }
    });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`HEIST node fullstack server listening on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((error) => {
  console.error("Error starting server:", error);
});
var server_default = app;
export {
  server_default as default
};
//# sourceMappingURL=server.js.map
