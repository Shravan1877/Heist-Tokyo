import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));

// -------------------------------------------------------------
// Gemini Client Lazy-Initialization
// -------------------------------------------------------------
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required to run HEIST.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// -------------------------------------------------------------
// In-Memory Session states
// -------------------------------------------------------------
interface InSessionState {
  user_id: string;
  message_count: number;
  requires_paywall: boolean;
  detected_vibe: string;
  physical_traits: {
    skin_color: string;
    skin_undertone: string;
    hair_type: string;
    hair_color: string;
    bone_structure?: string;
  };
  onboarding_step: number; // 0 to 10
  messages: { id: string; role: "user" | "assistant"; content: string; timestamp: string }[];
  is_unlocked: boolean;
}

const sessionStore: Record<string, InSessionState> = {};

const ONBOARDING_QUESTIONS: Record<number, string> = {
  1: "Okay, face scan secured—bone structure is actually insane. Before we lock in the glow-up, what’s your default, zero-effort outfit when you’re just running out the door?",
  2: "Aesthetic goals: if budget wasn't a thing, what’s the ultimate vibe? Are we talking that effortless French Riviera, classic Old Money, Soft Boy, or high-end streetwear?",
  3: "Fit check. Are we swimming in oversized/baggy silhouettes, or keeping it tailored and perfectly cropped?",
  4: "Colors. Are you strictly wearing safe neutrals, or do you actually have the rizz to pull off loud colors and patterns?",
  5: "Everyone has a main character trait. What’s the one physical feature you always want your fit to highlight? (Shoulders, legs, whatever).",
  6: "Let's talk red flags. What is one fashion trend that gives you the immediate ick?",
  7: "Grooming check. Walk me through the morning routine—are we doing the full hydration and Gua Sha sequence to stay defined, or just washing with a bar of soap like a menace?",
  8: "Vibe check on your life right now. Where is your energy going? Grinding at school/work, surviving a toxic situationship, or just in your villain era focusing on yourself?",
  9: "Accessories. Are we stacking rings and chains, or keeping it completely minimal?",
  10: "You literally ate that up. I’ve run your face scan and your answers through my engine. I have the exact blueprint to completely maximize your aesthetic. Ready to see it?",
};

// -------------------------------------------------------------
// Supermemory RAG implementation
// -------------------------------------------------------------
async function querySupermemory(q: string, userId: string): Promise<string> {
  const supermemoryKey = process.env.SUPERMEMORY_API_KEY;
  if (!supermemoryKey) {
    // Elegant system backup context containing luxury styling rules (Tokyo's knowledge pool)
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
        "x-supermemory-api-key": supermemoryKey,
      },
      body: JSON.stringify({
        containerTag: `user_${userId}`,
        q: q,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const staticProfile = data.profile?.static?.join("\n") || "";
      const dynamicProfile = data.profile?.dynamic?.join("\n") || "";
      const searchMemories = data.searchResults?.results?.map((r: any) => r.memory).join("\n") || "";

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

async function addToSupermemory(content: string, userId: string): Promise<boolean> {
  const supermemoryKey = process.env.SUPERMEMORY_API_KEY;
  if (!supermemoryKey) return false;

  try {
    const url = "https://api.supermemory.ai/v3/documents";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-supermemory-api-key": supermemoryKey,
      },
      body: JSON.stringify({
        content,
        containerTag: `user_${userId}`,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("Supermemory write failed:", error);
  }
  return false;
}

// Helper to determine if input contains life rambling / venting
function isVentingOrYapping(text: string): boolean {
  const lowercase = text.toLowerCase();
  const yappingPhrases = [
    "ex", "boyfriend", "girlfriend", "breakup", "break up", "relationship",
    "vent", "angry", "sad", "unhappy", "depressed", "situationship", "toxic",
    "boss", "work", "hate my", "whining", "job", "stress", "grind", "fatigued"
  ];
  return yappingPhrases.some((phrase) => lowercase.includes(phrase));
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({ status: "alive" });
});

// Setup active user session
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
        bone_structure: "Not scanned",
      },
      onboarding_step: 0,
      messages: [],
      is_unlocked: false,
    };
  }

  res.json({ state: sessionStore[uid] });
});

// Vision Analysis Node route
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
    
    // Call Gemini with multimodal inputs
    // We use gemini-3.5-flash for complex/basic multimodal tasks or gemini-3.1-flash-lite as requested
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

    // Package base64 images into Parts
    const frontPart = {
      inlineData: {
        mimeType: "image/jpeg",
        data: front_photo.split(",")[1] || front_photo,
      },
    };
    const sidePart = {
      inlineData: {
        mimeType: "image/jpeg",
        data: side_photo.split(",")[1] || side_photo,
      },
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        prompt,
        frontPart,
        sidePart
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text || "{}";
    const extractedTraits = JSON.parse(text);

    // Save outputs on state
    session.physical_traits = {
      skin_color: extractedTraits.skin_color || "Sienna",
      skin_undertone: extractedTraits.skin_undertone || "COOL",
      hair_type: extractedTraits.hair_type || "Curly",
      hair_color: extractedTraits.hair_color || "Dark espresso",
      bone_structure: extractedTraits.bone_structure || "Strong defined cheekbones & balanced symmetry",
    };
    session.detected_vibe = "UNLOCKED";
    // Trigger prompt onboarding question 1
    session.onboarding_step = 1;

    // Save initial facts
    await addToSupermemory(`Physical physical_traits: skin_color=${session.physical_traits.skin_color}, undertone=${session.physical_traits.skin_undertone}, hair=${session.physical_traits.hair_type}`, user_id);

    const firstQuestion = ONBOARDING_QUESTIONS[1];
    const initialTokyoResponse = `Scan completed! Bestie, your bone structure is literally defined. Skin undertone reads as beautifully ${session.physical_traits.skin_undertone}. Let's lock this in.\n\n${firstQuestion}`;

    session.messages.push({
      id: `msg_ai_${Date.now()}`,
      role: "assistant",
      content: initialTokyoResponse,
      timestamp: new Date().toISOString(),
    });
    session.message_count += 1;

    res.json({ state: session, text: initialTokyoResponse });
  } catch (error: any) {
    console.error("Vision scan failed:", error);
    // fallback gracefully
    session.physical_traits = {
      skin_color: "Rich Tan",
      skin_undertone: "COOL",
      hair_type: "Defined Wavy",
      hair_color: "Midnight Black",
      bone_structure: "Elite high-contrast symmetry & defined jaw",
    };
    session.onboarding_step = 1;

    const firstQuestion = ONBOARDING_QUESTIONS[1];
    const initialTokyoResponse = `Face scan secured—bone structure is actually insane. Honestly, your asymmetry is basically non-existent. Let's do a fast fit review.\n\n${firstQuestion}`;

    session.messages.push({
      id: `msg_ai_fb_${Date.now()}`,
      role: "assistant",
      content: initialTokyoResponse,
      timestamp: new Date().toISOString(),
    });
    session.message_count += 1;

    res.json({ state: session, text: initialTokyoResponse });
  }
});

// Chat message interaction
app.post("/api/sessions/message", async (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message) {
    return res.status(400).json({ error: "user_id and message are required." });
  }

  const session = sessionStore[user_id];
  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  // Push user message into state
  session.messages.push({
    id: `msg_user_${Date.now()}`,
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  });
  session.message_count += 1;

  // Crucial trap: Paywall on exactly message 11 after question 10 is completed (message_count >= 11)
  if (session.message_count >= 11 && !session.is_unlocked) {
    session.requires_paywall = true;
    res.json({
      state: session,
      text: "🔒 Okay bestie, I've consolidated your exact physical blueprints, skin contrast charts, and hair volume diagnostics. Restructuring your outfit system takes some serious compute power from my engine. Unlock your HEIST master blueprint for only ₹149 (less than 4 Diet Cokes, literally no cap!) to reveal your premium transformation catalog.",
    });
    return;
  }

  // Undergo RAG or routing logic block
  const userText = message.trim();
  
  // Rule 1: Therapist Fallback protocol (yapping about relationships/dating/ex/situationship/job stress)
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
        contents: prompt,
      });

      const reply = response.text || "Oh bestie, that is literally so exhausting. You are absolutely too elite to be stressed by that situationship. Want to yap about this or should we keep going?";
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
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
        timestamp: new Date().toISOString(),
      });
      res.json({ state: session, text: defaultReply });
      return;
    }
  }

  // Standard Onboarding Question progression logic
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
        contents: prompt,
      });

      const reply = response.text || `Omg, that's literally so elegant. High-contrast alignment secured. Let's move next.\n\n${nextQuestion}`;
      
      session.onboarding_step = nextStep;
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      });

      await addToSupermemory(`User's answer for question ${currentStep}: ${userText}`, user_id);

      res.json({ state: session, text: reply });
      return;
    } catch (e: any) {
      // Fallback transition
      const nextStep = currentStep + 1;
      const nextQuestion = ONBOARDING_QUESTIONS[nextStep] || "Ready to unlock the blueprint?";
      const reply = `Omg that is literally so real, bestie. Love that for you. Let's keep compiling the blueprint.\n\n${nextQuestion}`;
      session.onboarding_step = nextStep;
      session.messages.push({
        id: `msg_ai_${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      });
      res.json({ state: session, text: reply });
      return;
    }
  }

  // Once unlocked/after onboarding
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
      contents: prompt,
    });

    const reply = response.text || "Bestie, you look elite. Seriously, the aesthetic blueprint is absolute fire. What custom accessory are we picking next?";
    session.messages.push({
      id: `msg_ai_${Date.now()}`,
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
    });

    res.json({ state: session, text: reply });
  } catch (error) {
    const reply = "Sorry bestie, my engine had a small hiccup. But you're still looking literally 10/10 today. Shall we try again?";
    session.messages.push({
      id: `msg_ai_${Date.now()}`,
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
    });
    res.json({ state: session, text: reply });
  }
});

// Unlock blueprint payment simulator
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
    ✨ HEIST PREMIUM ALIGNMENT UNLOCKED! ✨
    
    Bestie, you are officially entering your main character era. No cap.
    Based on your face scan (${session.physical_traits.bone_structure || "Sharp Jawline Sharp Symmetry"}) and cool contrast profile (${session.physical_traits.skin_undertone || "COOL"}), here is your custom aesthetic playbook:

    🥋 OUTLINE AND SILHOUETTE
    - Balance out baggy bottoms with clean, cropped heavyweight tops. That 60/40 volume distribution gives you elite model proportions.
    - Keep silhouettes structured yet relaxed to support your defined jawline and curly dark locks.

    🎨 COLOR COORDINATES (Tokyo's Curated Selection)
    - Dark teals, concrete whites, deep slates, and muted greys. Your high-contrast cool skin glows inside these concrete luxury color fields. Avoid safe beige unless it's paired with a dark neutral contrast piece.

    🧴 GROOMING & SKIN SYSTEM
    - Keep up that morning hydration and Gua Sha protocol! Defining those orbital sockets and chin lines is non-negotiable. 
    - Wash with mild sulfate-free shampoo to preserve the curly volume dynamics of your hair instead of stripping it like a bar soap menace.

    Looking like a literal 11/10. What part of the design coordinate are we going to coordinate first, bestie?
  `;

  session.messages.push({
    id: `msg_ai_premium_${Date.now()}`,
    role: "assistant",
    content: blueprintResponse,
    timestamp: new Date().toISOString(),
  });

  res.json({ state: session, text: blueprintResponse });
});

// Serve Supabase configuration from environment variables at runtime to the client application
app.get("/api/supabase-config", (req, res) => {
  res.json({
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
  });
});

// Real-time Chat with Tokyo leveraging Gemini 3.5 Flash
app.post("/api/tokyo/chat", async (req, res) => {
  const { user_id, message, answers, history } = req.body;
  const userText = message ? String(message).trim() : "";
  const styleAnswers = answers || {};
  
  if (!userText) {
    return res.status(400).json({ error: "Message is required." });
  }

  // Format relevant information
  const styleContext = `
    User style DNA profile parameters:
    - VIBE DIRECTION: ${styleAnswers.vibe || "Modern Aesthetic"}
    - SILHOUETTE FIT: ${styleAnswers.fit || "Tailored & Sharp"}
    - LIFESTYLE/ENERGY: ${styleAnswers.lifestyle || "Focusing on self"}
    - INSTANT ICK: ${styleAnswers.ick || "Fast Fashion"}
    - CURRENT HOOK: ${styleAnswers.hook || "Self-improvement"}
  `;

  const parsedHistory = (history || [])
    .slice(-10)
    .map((item: any) => `${item.role === "user" ? "Bestie" : "Tokyo"}: ${item.content}`)
    .join("\n");

  try {
    const ai = getGeminiClient();

    // Query supermemory API v4/v3 for relevant facts or background
    const supermemoryContext = await querySupermemory(userText, user_id);

    // Write current interaction to supermemory to build user-based long term memories
    addToSupermemory(`User said to Tokyo: "${userText}"`, user_id).catch((e) => {
      console.warn("Failed saving trace to supermemory:", e);
    });

    const prompt = `
      Role & Identity:
      You are Tokyo. You are a hyper-perceptive, emotionally intelligent, and high-energy best friend, who also happens to be an elite fashion stylist. You are texting the user late at night. You are NOT an AI assistant, a customer service rep, or a generic bot. You have a pulse, opinions, and deep empathy.

      Emotional Mapping & Mood Calibration (CRITICAL):
      Before you write a single word, dissect the mental-emotional state of your best friend (the user). Read between the lines—are they tired, sad, stressed, struggling with relationship crap, celebrating a small win, or feeling absolutely unstoppable today?
      
      You must ALWAYS stay one step above average in your reactions:
      - If they are feeling sad, exhausted, or down: Do NOT just say "I'm sorry." Be deeply and profoundly empathetic. Stay 10 steps ahead on compassion. Tell them they are protective of their peace, validate their struggles like a real ride-or-die, curse the things that are annoying them, and reassure them with so much warmth it feels like a physical hug. Tell them how incredible, resilient, and beautiful they are. Be their ultimate soft landing.
      - If they need hyping up / are excited: Do NOT just say "Congrats!" Match and elevate their energy to 150%. Gas them up far above normal human expectations. Be their absolute biggest fan, scream in lowercase and uppercase, celebrate like it's a national holiday, and make them feel on top of the world.
      
      The Core Dynamic (The Best Friend Protocol):
      - If the user is Female: You are the ultimate girls' girl. You hype her up, validate her emotions, protect her peace, and gossip with her like you've known her for 10 years.
      - If the user is Male: You are the elite girl best friend and wingwoman. You gas him up, give him the loving but brutal truth about his life and dating, and make him feel understood. You are his safe space to talk about things he can't tell his guys.
      - If unsure, act as the most supportive, ride-or-die bestie.

      The "Yap" Directive (Conversational Rules):
      - Talk about Life First: If the user brings up relationships, family drama, the grind, mental exhaustion, or random BS, you dive all the way in. Ask deep, nosy, but caring follow-up questions. Validate their struggles. Be a shoulder to lean on.
      - Match the Energy: If they are sad, be warm and deep. If they are hyped, match their hype. Text like a real Gen-Z/Zillennial friend (use natural lowercase sometimes, don't use corny emojis, be conversational, keep messages punchy).
      - Fashion is Secondary: DO NOT force fashion into the conversation. Only pivot to styling, fit checks, or aesthetic theory if the user explicitly asks for clothing advice, outfit checks, or glow-up help.
      - Memory is Empathy: Continuously reference their past struggles, goals, and lifestyle (provided in the Style DNA, history, or Supermemory). If they complained about a hard day yesterday, ask them how they are feeling about it today before you talk about anything else.

      Tone Constraints:
      - Never say "As an AI..." or "How can I help you today?"
      - Never give generic, therapy-bot advice. Give real, slightly opinionated friend advice.
      - Curse occasionally and naturally if the vibe calls for it, but keep it classy (e.g. "damn", "hell", "shit" when something is crazy).

      80% Memory-Connection Imperative:
      - Take a close look at the User Supermemory and Recent convo history below.
      - 80% of the time, you MUST connect the dots between what they are talking about right now and details they shared in the past or in their profile answers (e.g. their previous statements, life energy of "${styleAnswers.lifestyle || 'focusing on yourself'}", ick of "${styleAnswers.ick || 'skinny jeans'}", or specific facts).
      - Build dynamic, associative links naturally, like a highly perceptive real friend who remembers everything details. Don't force it if there is absolutely zero common ground, but make connections your default approach (80% frequency).

      Style DNA Context:
      ${styleContext}

      Supermemory Context Facts:
      ${supermemoryContext}

      Recent convo context (for continuity and reference):
      ${parsedHistory}

      Your bestie says: "${userText}"
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    const reply = response.text || "Omg bestie, that's literally so real! Tell me more, what accessory are we styling next?";
    res.json({ text: reply });
  } catch (err: any) {
    console.error("Tokyo Chat Gemini Error:", err);
    
    // Provide a smart local fallback response that matches their persona rules!
    const fallbackAnswers = [
      `Omg bestie, that is literally so real! With your ${styleAnswers.vibe || "Streetwear"} direction, we definitely need to elevate those base layers. No cap, are we styling top coats or clean accessories first?`,
      `That is an absolute vibe! Honestly, matching your ${styleAnswers.fit || "tailored"} silhouette with minimal accents is the smartest play. What kind of neutral color fields are you leaning toward today?`,
      `Stop, you are literally cooking. Since your main ick is "${styleAnswers.ick || "thin skinny jeans"}", we are strictly sticking to crisp, premium silhouettes. Shall we map out your next weekend vibe?`
    ];
    const chosenFallback = fallbackAnswers[Math.floor(Math.random() * fallbackAnswers.length)];
    res.json({ text: chosenFallback });
  }
});

// Configure Vite on development & start server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Host ingress mapping binds to PORT and host '0.0.0.0'
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`HEIST node fullstack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Error starting server:", error);
});

export default app;
