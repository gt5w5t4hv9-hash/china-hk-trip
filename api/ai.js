// api/ai.js — сервер для работы с Groq API
const MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile"; // Можно заменить на другую модель
const MAX_OUTPUT_TOKENS = 700;

module.exports = async function handler(req, res) {
  // Настройка CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // GET-запрос для проверки статуса
  if (req.method === "GET") {
    res.status(200).json({ ok: true, hasKey: !!process.env.GROQ_API_KEY });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // Проверка наличия API-ключа
  if (!process.env.GROQ_API_KEY) {
    res.status(500).json({ error: "server_misconfigured", answer: "На сервере не настроен GROQ_API_KEY." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const query = String(body.query || "").slice(0, 2000);
  const context = String(body.context || "").slice(0, 12000);

  if (!query.trim()) {
    res.status(400).json({ error: "empty_query" });
    return;
  }

  // Формируем системный промпт
  const systemPrompt = [
    "Ты — ИИ-помощник внутри мобильного гида по поездке в Китай и Гонконг (11–27 сентября 2026).",
    "Отвечай по-русски, коротко и по делу — это мобильный чат. 3–8 предложений или компактный список.",
    "Если вопрос — про сам маршрут, в первую очередь опирайся на КОНТЕКСТ МАРШРУТА ниже.",
    "Если не уверен — так и скажи, не выдумывай.",
    "",
    "КОНТЕКСТ МАРШРУТА:",
    context
  ].filter(Boolean).join("\n");

  try {
    // Отправляем запрос к Groq API
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        max_tokens: MAX_OUTPUT_TOKENS
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const errorMessage = data.error?.message || "Неизвестная ошибка от Groq API";
      res.status(upstream.status).json({
        error: "upstream_error",
        answer: `Ошибка ИИ: ${errorMessage} (код ${upstream.status})`
      });
      return;
    }

    const answer = data.choices?.[0]?.message?.content?.trim() || "Не удалось получить ответ.";

    res.status(200).json({
      answer: answer,
      web: false, // Groq не поддерживает поиск в интернете
      sources: []
    });
  } catch (err) {
    res.status(500).json({
      error: "server_error",
      answer: "Ошибка на сервере: " + (err?.message || "неизвестная")
    });
  }
};
