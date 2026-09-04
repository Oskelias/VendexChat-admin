import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://admin.vendexchat.app",
  "https://vendexchat.app",
  "http://localhost:5173",
];

const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 8000;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    // El cliente de Supabase (functions.invoke) manda también "apikey" y "x-client-info"
    // además de authorization/content-type — si el preflight no los declara acá, el
    // navegador rechaza la llamada real después de aceptar el OPTIONS (por eso en los
    // logs solo aparecía el preflight en 200 y nunca el POST real).
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verificar JWT del llamador
  const authHeader = req.headers.get("authorization") ?? "";
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Leer y validar body
  let messages: { role: string; content: string }[];
  let temperature: number;
  try {
    const body = await req.json();
    messages = body.messages;
    temperature = typeof body.temperature === "number" ? body.temperature : 0.3;

    if (!Array.isArray(messages) || messages.length === 0) throw new Error();
    if (messages.length > MAX_MESSAGES) throw new Error("Too many messages");

    for (const msg of messages) {
      if (!["system", "user", "assistant"].includes(msg.role)) throw new Error("Invalid role");
      if (typeof msg.content !== "string") throw new Error("Invalid content");
      if (msg.content.length > MAX_CONTENT_LENGTH) throw new Error("Content too long");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Body inválido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    return new Response(JSON.stringify({ error: "Configuración incompleta" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqKey}`,
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    return new Response(JSON.stringify({ error: `Groq error: ${err}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await groqRes.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
