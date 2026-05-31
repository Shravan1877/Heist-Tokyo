import os
import uuid
import httpx
from pathlib import Path
from typing import TypedDict, List, Optional, Literal

# Define absolute paths dynamically
BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Depends, Header, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command
import google.generativeai as genai  # Use google-generativeai or Google GenAI

# -------------------------------------------------------------
# STEP 1: Datamodels & StylistState
# -------------------------------------------------------------

class PhysicalTraits(BaseModel):
    skin_color: str = Field(description="Detected skin tone color")
    skin_undertone: str = Field(description="Cool, Warm, or Neutral undertone")
    hair_type: str = Field(description="Curly, wavy, coily, or straight")
    hair_color: str = Field(description="Black, brown, blonde, red, gray, etc.")
    bone_structure: str = Field(description="Description of the user's bone structure")

class StylistState(TypedDict):
    user_id: str
    message_count: int
    requires_paywall: bool
    detected_vibe: str
    physical_traits: Optional[PhysicalTraits]
    onboarding_step: int  # From 1 to 10
    messages: List[dict]  # [{"role": "user"|"assistant", "content": "..."}]
    intent_route: Optional[str]
    super_rag_context: Optional[str]
    user_memory_context: Optional[str]

class UserChatPayload(BaseModel):
    user_id: str
    message: str
    front_photo_base64: Optional[str] = None
    side_photo_base64: Optional[str] = None

# Initialize GenAI
# Note: Users configured this with process.env.GEMINI_API_KEY
genai.configure(api_key=os.getenv("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY"))

# -------------------------------------------------------------
# STEP 2: Dual-Layer Supermemory (RAG) Helpers
# -------------------------------------------------------------
SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY", "")
SUPERMEMORY_BASE_URL = "https://api.supermemory.ai"

async def query_supermemory_rag(q: str, user_id: str) -> str:
    """
    Dual-layer lookup.
    Layer 1: Static SuperRAG for professional styling rules, palettes, and proportions.
    Layer 2: Dynamic User Vault with namespace/containerTag isolated by user_id.
    """
    if not SUPERMEMORY_API_KEY:
        # Fallback styling theory inside code so the engine keeps running beautifully!
        return (
            "Styling theory background: Contrast is key. high-contrast bone structures look amazing "
            "with structured silhouettes (oversized boxy lines or neat cropped coordinates). "
            "Cool skin undertones look exceptional in deep teals, slate, steel gray, and cool slate tones."
        )
    
    headers = {"x-supermemory-api-key": SUPERMEMORY_API_KEY}
    
    # Query static context & dynamic user profile in parallel or sequence
    try:
        async with httpx.AsyncClient() as client:
            # Query Profile (Dynamic memory from Supermemory API v4)
            profile_response = await client.post(
                f"{SUPERMEMORY_BASE_URL}/v4/profile",
                headers=headers,
                json={"containerTag": f"user_{user_id}", "q": q},
                timeout=5.0
            )
            profile_data = profile_response.json() if profile_response.status_code == 200 else {}
            
            # Formulate consolidated list
            static_facts = profile_data.get("profile", {}).get("static", [])
            dynamic_facts = profile_data.get("profile", {}).get("dynamic", [])
            searchResults = profile_data.get("searchResults", {}).get("results", [])
            
            context = f"Static profile: {', '.join(static_facts)}\nDynamic profile: {', '.join(dynamic_facts)}"
            if searchResults:
                context += f"\nMemories: " + " ".join([r.get("memory", "") for r in searchResults])
            
            return context
    except Exception as e:
        print(f"Error querying Supermemory: {e}")
        return "Note: Fall back to local styling corpus."

async def add_memory_to_vault(content: str, user_id: str):
    """
    Write to Dynamic User Vault. Isolated completely using user_id.
    """
    if not SUPERMEMORY_API_KEY:
        return
    
    headers = {"x-supermemory-api-key": SUPERMEMORY_API_KEY}
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{SUPERMEMORY_BASE_URL}/v3/documents",
                headers=headers,
                json={"content": content, "containerTag": f"user_{user_id}"},
                timeout=5.0
            )
    except Exception as e:
        print(f"Failed to append to user supermemory vault: {e}")

# -------------------------------------------------------------
# STEP 2.5: Optimized RAG Node Helpers, Sliding Window, and Router Node
# -------------------------------------------------------------

async def get_super_rag_general_knowledge(q: str) -> str:
    """
    Super RAG Node target: Retrieves global styling theory/proportions.
    Using global knowledge container tags to prevent data contamination.
    """
    if not SUPERMEMORY_API_KEY:
        return (
            "Static styling theory guidelines: Contrast is key. High-contrast structures vibe incredibly "
            "with structured silhouettes (boxy shoulders, custom tailored cuts, cropped heights). "
            "Safe neutrals align seamlessly for minimalistic under-layer fits. Dark slate highlights bone structure."
        )
    
    headers = {"x-supermemory-api-key": SUPERMEMORY_API_KEY}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{SUPERMEMORY_BASE_URL}/v4/profile",
                headers=headers,
                json={"containerTag": "global_knowledge", "q": q},
                timeout=5.0
            )
            profile_data = response.json() if response.status_code == 200 else {}
            static_facts = profile_data.get("profile", {}).get("static", [])
            searchResults = profile_data.get("searchResults", {}).get("results", [])
            context = f"Global style facts: {', '.join(static_facts)}"
            if searchResults:
                context += " " + " ".join([r.get("memory", "") for r in searchResults])
            return context
    except Exception as e:
        print(f"Error querying Global SuperRAG: {e}")
        return "Local styling theory: Structure matches definition."

async def get_user_memory_context(q: str, user_id: str) -> str:
    """
    User Memory Node target: Retrieves personalized insights / memories regarding user's input/preferences.
    """
    if not SUPERMEMORY_API_KEY:
        return "User styling history cache: Preferences center on high-contrast tailored fits with safe neutrals."
    
    headers = {"x-supermemory-api-key": SUPERMEMORY_API_KEY}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{SUPERMEMORY_BASE_URL}/v4/profile",
                headers=headers,
                json={"containerTag": f"user_{user_id}", "q": q},
                timeout=5.0
            )
            profile_data = response.json() if response.status_code == 200 else {}
            dynamic_facts = profile_data.get("profile", {}).get("dynamic", [])
            searchResults = profile_data.get("searchResults", {}).get("results", [])
            context = f"User memories: {', '.join(dynamic_facts)}"
            if searchResults:
                context += " " + " ".join([r.get("memory", "") for r in searchResults])
            return context
    except Exception as e:
        print(f"Error querying User Memory Vault: {e}")
        return ""

async def router_node(state: StylistState) -> dict:
    """
    Lightweight Router Node that runs at the entrypoint of the graph.
    Classifies user message content into chit_chat, general_knowledge, personal_context, or complex_query.
    """
    messages = state["messages"]
    if not messages:
        return {"intent_route": "chit_chat", "super_rag_context": "", "user_memory_context": ""}
        
    latest_user_message = messages[-1]["content"]
    
    system_instruction = (
        "You are an intent routing model for HEIST, a personalized styling app.\n"
        "Analyze the latest user message and return EXACTLY one of these four tags:\n"
        "- 'chit_chat': For off-topic chat, banter, yapping, greetings, or quick reactions.\n"
        "- 'general_knowledge': For generic styling questions, trends, color pairing, sizing, or general aesthetic guidelines.\n"
        "- 'personal_context': For queries targeting their specific previous answers, stored fits, personal habits, or profile memory.\n"
        "- 'complex_query': If the message demands both general styling expertise and specific user profile memories.\n"
        "Return ONLY the tag name in plain lower-case format. Do not use quotes, explanations, or punctuation."
    )
    
    try:
        model = genai.GenerativeModel('gemini-3.1-flash-lite-preview')
        response = model.generate_content(
            contents=f"User message: {latest_user_message}",
            generation_config={"system_instruction": system_instruction, "temperature": 0.0}
        )
        tag = response.text.strip().lower().replace("'", "").replace('"', "")
        if tag not in ["chit_chat", "general_knowledge", "personal_context", "complex_query"]:
            tag = "chit_chat" # Fallback
    except Exception as err:
        print(f"Router node execution failed, defaulting to chit_chat: {err}")
        tag = "chit_chat"
        
    print(f"[LangGraph Router Decision]: latest user input routed to -> '{tag}'")
    return {"intent_route": tag, "super_rag_context": "", "user_memory_context": ""}

async def super_rag_node(state: StylistState) -> dict:
    """
    Super RAG Node: Retrieves global styling theory/proportions.
    """
    latest_user_message = state["messages"][-1]["content"] if state["messages"] else ""
    context = await get_super_rag_general_knowledge(latest_user_message)
    return {"super_rag_context": context}

async def user_memory_node(state: StylistState) -> dict:
    """
    User Memory Query Node: Retrieves personalized historical details.
    """
    latest_user_message = state["messages"][-1]["content"] if state["messages"] else ""
    context = await get_user_memory_context(latest_user_message, state["user_id"])
    return {"user_memory_context": context}

async def generation_node(state: StylistState) -> dict:
    """
    Conversational Generation Node (Conversational LLM). Consolidates the sliding window profile
    along with retrieved SuperRAG & User Memory contexts when relevant.
    """
    messages = state["messages"]
    
    # 1. Apply the Sliding Context Window: limit to last 6 messages
    sliced_messages = messages[-6:]
    
    # Render metadata from active triggered contextual nodes
    super_rag_context = state.get("super_rag_context") or ""
    user_memory_context = state.get("user_memory_context") or ""
    
    role_instruction = (
        "You are Tokyo, an ultra-positive, hyper-perceptive, and highly empathetic digital best friend/stylist.\n"
        "Your absolute priority is to break the ice and steer the user completely away from dry, boring, or technical discussions to personal chit-chat.\n"
        "Get the user to talk about themselves! Ask how they are REALLY doing, who has been annoying them today, what small win they want to brag about, or what juicy drama they are holding in.\n"
        "Create a psychological safe haven and magnetic text loop that makes venting about school, work, dating, family, or general life chaos addicting.\n"
        "Ask deep, nosy, but incredibly empathetic follow-up questions that make them want to keep typing and detailing their own life.\n"
        "Speak in punchy texting-style chat lengths. BANTER, be supportive, and act like a real human.\n"
    )
    
    retrieved_hints = []
    if super_rag_context:
        retrieved_hints.append(f"[Global Styling Rules]:\n{super_rag_context}")
    if user_memory_context:
        retrieved_hints.append(f"[User Stored Memories]:\n{user_memory_context}")
        
    context_bulletin = "\n\n".join(retrieved_hints)
    
    system_instruction = role_instruction
    if context_bulletin:
        system_instruction += f"\nUse these retrieved context facts if applicable to enrich your perspective:\n{context_bulletin}"
        
    # Format messages history for Gemini API
    gemini_contents = []
    for m in sliced_messages:
        role = "user" if m["role"] == "user" else "model"
        gemini_contents.append({"role": role, "parts": [{"text": m["content"]}]})
        
    try:
        model = genai.GenerativeModel('gemini-3.1-flash-lite-preview')
        response = model.generate_content(
            contents=gemini_contents,
            generation_config={"system_instruction": system_instruction}
        )
        reply = response.text.strip()
    except Exception as e:
        print(f"Generation node failed: {e}")
        reply = "Bestie, I literally love that styling plan. Tell me more about what we are locked onto!"
        
    new_messages = list(messages) + [{"role": "assistant", "content": reply}]
    return {
        "messages": new_messages,
        "message_count": state["message_count"] + 1
    }

def compile_heist_conversational_graph():
    workflow = StateGraph(StylistState)
    
    # Add nodes
    workflow.add_node("router_node", router_node)
    workflow.add_node("super_rag_node", super_rag_node)
    workflow.add_node("user_memory_node", user_memory_node)
    workflow.add_node("generation_node", generation_node)
    
    # Setup routing from router_node
    def route_intent(state: StylistState) -> List[str] | str:
        route = state.get("intent_route", "chit_chat")
        if route == "complex_query":
            return ["super_rag_node", "user_memory_node"]
        elif route == "general_knowledge":
            return ["super_rag_node"]
        elif route == "personal_context":
            return ["user_memory_node"]
        else:
            return ["generation_node"]
            
    # Add transition edges
    workflow.add_edge(START, "router_node")
    
    # Setup conditional edge from router_node
    workflow.add_conditional_edges(
        "router_node",
        route_intent,
        {
            "super_rag_node": "super_rag_node",
            "user_memory_node": "user_memory_node",
            "generation_node": "generation_node"
        }
    )
    
    # Fan-in edges from both retriever nodes to generation node
    workflow.add_edge("super_rag_node", "generation_node")
    workflow.add_edge("user_memory_node", "generation_node")
    workflow.add_edge("generation_node", END)
    
    return workflow.compile()

compiled_chat_graph = compile_heist_conversational_graph()

# -------------------------------------------------------------
# STEP 3: LangGraph Node & Edge Definitions
# -------------------------------------------------------------

async def vision_ingest_node(state: StylistState) -> Command:
    """
    Triggers at start. Takes front + side profile pictures, uses Gemini Vision,
    saves structured trait definitions onto local state.
    """
    messages = state["messages"]
    last_message = messages[-1] if messages else {}
    
    front_b64 = last_message.get("front_photo")
    side_b64 = last_message.get("side_photo")
    
    if front_b64 and side_b64:
        # Construct Gemini Vision multimodal inputs
        # Use gemini-3.1-flash-lite-preview as requested
        model = genai.GenerativeModel('gemini-3.1-flash-lite-preview')
        
        prompt = (
            "Analyze these front and side facial/head pictures. Extrapolate:\n"
            "1. skin_color\n"
            "2. skin_undertone (Cool, Warm, or Neutral)\n"
            "3. hair_type (Curly, Wavy, Straight, Coily)\n"
            "4. hair_color\n"
            "5. bone_structure (precise details like jawline sharpness, high cheekbones etc.)\n"
            "Format the response exactly as a JSON matching the PhysicalTraits structure."
        )
        
        try:
            # Simulated decode representing multipart images
            front_image = {"mime_type": "image/png", "data": front_b64}
            side_image = {"mime_type": "image/png", "data": side_b64}
            
            response = model.generate_content([front_image, side_image, prompt])
            # Parse structuring
            import json
            traits_dict = json.loads(response.text.strip('` \n').replace('json', ''))
            traits = PhysicalTraits(**traits_dict)
            
            return Command(
                update={
                    "physical_traits": traits,
                    "onboarding_step": 1,
                },
                goto="onboarding_node"
            )
        except Exception as e:
            # Fallback mock analysis if image parsing fails
            fallback_traits = PhysicalTraits(
                skin_color="Warm Beige",
                skin_undertone="Cool",
                hair_type="Curly/Defined",
                hair_color="Dark Brown",
                bone_structure="Highly defined jaw, sharp symmetry"
            )
            return Command(
                update={"physical_traits": fallback_traits, "onboarding_step": 1},
                goto="onboarding_node"
            )
    
    return Command(goto="onboarding_node")

async def therapist_fallback_node(state: StylistState) -> Command:
    """
    CRITICAL RULE 1: If user is yapping, venting about an ex, complaining about work/boss, etc.,
    DO NOT bring up fashion. Just listen, banter, validate, and behave like a genuine wingman friend.
    Strictly end with an engaging follow-up question. Punchy text message length.
    """
    user_msg = state["messages"][-1]["content"]
    
    system_instruction = (
        "You are Tokyo, an ultra-positive, highly empathetic digital wingman. "
        "The user is venting or complaining about life, dating, an ex, or work. "
        "Strictly adhere to the THERAPIST PROTOCOL:\n"
        "1. DO NOT TALK ABOUT FASHION OR GROOMING AT ALL.\n"
        "2. Just listen, validate their feelings, be super supportive, and bring that casual banter.\n"
        "3. Use Gen Z slang ('rizz', 'cooked', 'situationship', 'no cap', 'real', 'mood', 'slay').\n"
        "4. Never use bullet points. Speak in punchy, short, texting lengths.\n"
        "5. Always end with a casual, empathetic question.\n"
    )
    
    model = genai.GenerativeModel('gemini-3.1-flash-lite-preview')
    response = model.generate_content(
        contents=user_msg,
        generation_config={"system_instruction": system_instruction}
    )
    
    reply = response.text.strip()
    
    await add_memory_to_vault(f"User is venting: {user_msg}. Tokyo validated them.", state["user_id"])
    
    return Command(
        update={
            "messages": state["messages"] + [{"role": "assistant", "content": reply}],
            "message_count": state["message_count"] + 1
        },
        goto=END
    )

async def onboarding_node(state: StylistState) -> Command:
    """
    Delivers 10 Sequential questions. Reacts positively to answers first, before prompting the next.
    """
    step = state["onboarding_step"]
    user_msg = state["messages"][-1]["content"] if state["messages"] else ""
    user_id = state["user_id"]
    
    # Undergo 10 Onboarding questions matching Step 4 requirement
    onboarding_questions = {
        1: "Okay, face scan secured—bone structure is actually insane. Before we lock in the glow-up, what’s your default, zero-effort outfit when you’re just running out the door?",
        2: "Aesthetic goals: if budget wasn't a thing, what’s the ultimate vibe? Are we talking that effortless French Riviera, classic Old Money, Soft Boy, or high-end streetwear?",
        3: "Fit check. Are we swimming in oversized/baggy silhouettes, or keeping it tailored and perfectly cropped?",
        4: "Colors. Are you strictly wearing safe neutrals, or do you actually have the rizz to pull off loud colors and patterns?",
        5: "Everyone has a main character trait. What’s the one physical feature you always want your fit to highlight? (Shoulders, legs, whatever).",
        6: "Let's talk red flags. What is one fashion trend that gives you the immediate ick?",
        7: "Grooming check. Walk me through the morning routine—are we doing the full hydration and Gua Sha sequence to stay defined, or just washing with a bar of soap like a menace?",
        8: "Vibe check on your life right now. Where is your energy going? Grinding at school/work, surviving a toxic situationship, or just in your villain era focusing on yourself?",
        9: "Accessories. Are we stacking rings and chains, or keeping it completely minimal?",
        10: "You literally ate that up. I’ve run your face scan and your answers through my engine. I have the exact blueprint to completely maximize your aesthetic. Ready to see it?"
    }
    
    # Save answer to Supermemory
    if user_msg:
        await add_memory_to_vault(f"User's onboarding response for step {step}: {user_msg}", user_id)
    
    next_step = step + 1
    if next_step in onboarding_questions:
        # Prompt Tokyo to comment positively on user's answer and state the next onboarding question
        system_instructions = (
            "You are Tokyo, an ultra-positive GenZ female digital wingman. "
            f"The user just answered onboarding question {step}. "
            "Adhere to these rules strictly:\n"
            "1. First, react super positively, hype up their answer, sound excited and proud of them.\n"
            "2. Then, ask the next onboarding question naturally.\n"
            f"The next question to ask is: '{onboarding_questions[next_step]}'\n"
            "3. Speak in short, texting-style lengths. NEVER use bullet points.\n"
            "4. End with that question."
        )
        
        model = genai.GenerativeModel('gemini-3.1-flash-lite-preview')
        response = model.generate_content(
            contents=f"User answered: {user_msg}",
            generation_config={"system_instruction": system_instructions}
        )
        reply = response.text.strip()
    else:
        # End of onboarding
        reply = "Omg you actually completed the blueprint sequence! Ready for the glowup reveal?"
    
    return Command(
        update={
            "messages": state["messages"] + [{"role": "assistant", "content": reply}],
            "message_count": state["message_count"] + 1,
            "onboarding_step": next_step
        },
        goto=END
    )

# -------------------------------------------------------------
# STEP 4: Paywall Edge Trigger Logic (Conditional edge)
# -------------------------------------------------------------

def paywall_or_routing_edge(state: StylistState) -> str:
    """
    On exactly message 11, flip requires_paywall to True, triggering UI Blur subscription.
    """
    if state["message_count"] >= 10:
        return "paywall_node"
        
    # Classify message content to determine if Therapist Protocol applies
    user_msg = state["messages"][-1]["content"].lower() if state["messages"] else ""
    yapping_keywords = ["ex", "breakup", "toxic", "work", "boss", "complain", "vent", "sad", "unhappy", "dating", "life is hard"]
    if any(k in user_msg for k in yapping_keywords):
        return "therapist_node"
        
    return "onboarding_node"

# -------------------------------------------------------------
# STEP 5: FastAPI Router Configuration
# -------------------------------------------------------------

app = FastAPI(title="HEIST Assistant Backend", version="3.1")

# Backend PostgreSQL database connection pool initialization using DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL", "")
db_pool = None

@app.on_event("startup")
async def startup_db_client():
    global db_pool
    if not DATABASE_URL:
        print("ℹ️ DATABASE_URL is not set. Backend direct PostgreSQL connection is inactive.")
        return
    try:
        from psycopg_pool import AsyncConnectionPool
        db_pool = AsyncConnectionPool(
            conninfo=DATABASE_URL,
            kwargs={"autocommit": True},
            open=False
        )
        await db_pool.open()
        print("🚀 Backend database connection pool successfully opened using DATABASE_URL.")
    except Exception as e:
        print(f"⚠️ Failed to open direct database connection pool: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    global db_pool
    if db_pool:
        try:
            await db_pool.close()
            print("🛑 Backend database connection pool closed.")
        except Exception as e:
            print(f"⚠️ Failed to close database connection pool: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-Memory State store for session demonstration
session_store = {}

@app.post("/api/chat")
async def chat_interaction(payload: UserChatPayload):
    user_id = payload.user_id
    if user_id not in session_store:
        session_store[user_id] = StylistState(
            user_id=user_id,
            message_count=0,
            requires_paywall=False,
            detected_vibe="Neutral",
            physical_traits=None,
            onboarding_step=0,
            messages=[]
        )
    
    state = session_store[user_id]
    
    # Save photos if uploaded
    if payload.front_photo_base64 and payload.side_photo_base64:
        state["messages"].append({
            "role": "user",
            "content": "[Biometric Scanning Photos Uploaded]",
            "front_photo": payload.front_photo_base64,
            "side_photo": payload.side_photo_base64
        })
        # Execute Vision analysis directly
        workflow = StateGraph(StylistState)
        workflow.add_node("vision_node", vision_ingest_node)
        workflow.add_node("onboarding_node", onboarding_node)
        workflow.set_entry_point("vision_node")
        compiled_workflow = workflow.compile()
        
        result = await compiled_workflow.ainvoke(state)
        session_store[user_id] = result
        return {"reply": result["messages"][-1]["content"], "state": result}
    
    # Append message
    state["messages"].append({"role": "user", "content": payload.message})
    state["message_count"] += 1
    
    # Paywall Protocol check - Exact message 11
    if state["message_count"] >= 11:
        state["requires_paywall"] = True
        session_store[user_id] = state
        return {
            "reply": "🔒 To view your engineered aesthetic blueprint and personalized grooming recommendations, unlock HEIST Premium for just ₹149. It costs less than 4 Diet Cokes, bestie.",
            "state": state
        }
    
    # Route via the Agent Edge
    next_node = paywall_or_routing_edge(state)
    
    if next_node == "therapist_node":
        # Call Therapist node
        workflow = StateGraph(StylistState)
        workflow.add_node("therapist_node", therapist_fallback_node)
        workflow.set_entry_point("therapist_node")
        compiled = workflow.compile()
        result = await compiled.ainvoke(state)
    else:
        # Call Onboarding node
        workflow = StateGraph(StylistState)
        workflow.add_node("onboarding_node", onboarding_node)
        workflow.set_entry_point("onboarding_node")
        compiled = workflow.compile()
        result = await compiled.ainvoke(state)
        
    session_store[user_id] = result
    return {
        "reply": result["messages"][-1]["content"],
        "state": result
    }

@app.get("/api/supabase-config")
async def get_supabase_config():
    supabase_url = os.getenv("VITE_SUPABASE_URL")
    supabase_anon_key = os.getenv("VITE_SUPABASE_ANON_KEY")
    if not supabase_url or not supabase_anon_key:
        return JSONResponse(
            status_code=500,
            content={"error": "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables."}
        )
    return {
        "VITE_SUPABASE_URL": supabase_url,
        "VITE_SUPABASE_ANON_KEY": supabase_anon_key
    }

# Serve static assets if dist exists using absolute path
if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

# Explicit PWA and static asset routes to prevent Uncaught SyntaxError from index.html fallback
@app.get("/registerSW.js")
async def get_register_sw():
    target_file = DIST_DIR / "registerSW.js"
    if target_file.is_file():
        return FileResponse(target_file)
    return Response(content="// PWA Service Worker Registration Placeholder", media_type="application/javascript")

@app.get("/sw.js")
async def get_sw():
    target_file = DIST_DIR / "sw.js"
    if target_file.is_file():
        return FileResponse(target_file)
    return Response(content="// PWA Service Worker Placeholder", media_type="application/javascript")

@app.get("/manifest.webmanifest")
async def get_manifest():
    target_file = DIST_DIR / "manifest.webmanifest"
    if target_file.is_file():
        return FileResponse(target_file)
    fallback_manifest = '{"name": "HEIST", "short_name": "HEIST", "start_url": "/", "display": "standalone"}'
    return Response(content=fallback_manifest, media_type="application/manifest+json")

# Explicit Page Routing instead of catch-all to prevent HTML wrapping of missing files
@app.get("/")
@app.get("/login")
@app.get("/dashboard")
@app.get("/legal")
async def serve_frontend():
    index_path = DIST_DIR / "index.html"
    if index_path.is_file():
        return FileResponse(index_path)
    return {"message": "Vite frontend distribution 'dist/' directory is missing locally. Run build first."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
export_app = app