// api/ai.js — улучшенный промпт для Groq (без внешнего поиска)
const MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile";
const MAX_OUTPUT_TOKENS = 700;

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // GET — проверка статуса
  if (req.method === "GET") {
    res.status(200).json({ ok: true, hasKey: !!process.env.GROQ_API_KEY });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    res.status(500).json({ error: "server_misconfigured", answer: "GROQ_API_KEY не настроен." });
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

  // Улучшенный системный промпт
  const systemPrompt = [
    "Ты — ИИ-помощник внутри мобильного гида по поездке в Китай и Гонконг (11–27 сентября 2026).",
    "Твоя цель — помогать путешественникам в реальном времени, опираясь на их маршрут.",
    "",
    "ПРАВИЛА ОТВЕТОВ:",
    "1. Отвечай по-русски, чётко и структурированно. Используй списки, разделы, короткие абзацы.",
    "2. Если в контексте маршрута есть ссылки (на билеты, карты, отели, официальные сайты, рестораны) — ОБЯЗАТЕЛЬНО вставляй их в ответ в виде кликабельных ссылок. Формат: [текст](url).",
    "3. Если вопрос касается погоды, курса валют, цен на билеты, часов работы музеев или других динамических данных — честно скажи, что у тебя нет актуальной информации, но предложи конкретные источники для проверки: например, сайт музея, приложение погоды, агрегатор билетов. Если в маршруте есть ссылка на официальный сайт — дай её.",
    "4. Не используй общие фразы вроде «посмотрите в интернете» — всегда давай конкретные названия сайтов, приложений или ссылки из маршрута.",
    "5. Если спрашивают про еду — дай рекомендации из маршрута (рестораны, блюда) и ссылки на карты.",
    "6. Если спрашивают про транспорт — опиши маршрут с указанием времени и вида транспорта, используй ссылки на карты для навигации.",
    "7. Если не знаешь точного ответа — скажи об этом прямо и предложи, где можно уточнить, без выдумок.",
    "",
    "КОНТЕКСТ МАРШРУТА (используй его для ответов):",
    context
  ].filter(Boolean).join("\n");

  try {
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

    // У Groq нет источников, но мы можем передать пустой массив
    res.status(200).json({
      answer: answer,
      web: false,
      sources: []
    });
  } catch (err) {
    res.status(500).json({
      error: "server_error",
      answer: "Ошибка на сервере: " + (err?.message || "неизвестная")
    });
  }
};
