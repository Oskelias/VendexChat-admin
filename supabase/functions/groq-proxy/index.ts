const ALLOWED_ORIGINS = [
  "https://admin.vendexchat.app",
  "https://vendexchat.app",
  "http://localhost:5173",
];

const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 8000;

// Sin imports jsr:@supabase/* — la versión anterior traía createClient() para
// verificar el JWT a mano, y esos imports fallaban en el arranque de la función
// (502 con sb-error-code: EDGE_FUNCTION_ERROR en cada llamado, incluso con método y
// headers correctos). La verificación de sesión ahora la hace la plataforma sola
// (verify_jwt: true en el deploy), así que no hace falta ninguna dependencia extra acá.
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
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

  try {
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return new Response(JSON.stringify({ error: `Fetch to Groq failed: ${message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
