// /api/ai — маленький бесплатный сервер: прячет ключ и даёт фронтенду настоящий ИИ
// с поиском в интернете, используя БЕСПЛАТНЫЙ (без карты, без списаний) уровень Gemini API.
// Деплой: Vercel Hobby (бесплатно) + бесплатный ключ с aistudio.google.com.
// Стоимость: $0. Бесплатный лимит — 1500 запросов в день на ключ, этого с большим запасом
// хватает на компанию из нескольких человек за всю поездку.

const MODEL = process.env.AI_MODEL || "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 700; // короткий ответ под мобильный чат

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // Лёгкий пинг для индикатора в интерфейсе — НЕ вызывает модель, бесплатно и не тратит квоту.
  if (req.method === "GET") {
    res.status(200).json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "server_misconfigured", answer: "На сервере не настроен GEMINI_API_KEY." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const query = String(body.query || "").slice(0, 2000);
  const context = String(body.context || "").slice(0, 12000);
  const location = body.location;
  const timezone = String(body.timezone || "").slice(0, 100);

  if (!query.trim()) {
    res.status(400).json({ error: "empty_query" });
    return;
  }

  const locationLine = location && location.lat
    ? `Координаты пользователя прямо сейчас: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} (точность ~${location.accuracy || "?"} м). Если вопрос про "рядом" — используй эти координаты вместе с маршрутом.`
    : "Точных координат пользователь не давал.";

  const systemPrompt = [
    "Ты — ИИ-помощник внутри мобильного гида по поездке в Китай и Гонконг (11–27 сентября 2026, Москва → Пекин → Шанхай → Ханчжоу → Гонконг → Хайкоу → Москва).",
    "Отвечай по-русски, коротко и по делу — это мобильный чат. 3–8 предложений или компактный список, без длинных вступлений.",
    "У тебя есть доступ к поиску в интернете — используй его для всего, что может измениться: часы работы, актуальные цены, погода, закрытия, транспорт, курс, визовые новости. Не гадай там, где можно проверить.",
    "Если вопрос — про сам маршрут, в первую очередь опирайся на КОНТЕКСТ МАРШРУТА ниже, а не на общие знания о Китае.",
    "Если не уверен и не можешь проверить — так и скажи, не выдумывай цены, часы работы или адреса.",
    locationLine,
    timezone ? `Часовой пояс устройства: ${timezone}.` : "",
    "",
    "КОНТЕКСТ МАРШРУТА:",
    context
  ].filter(Boolean).join("\n");

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
  };

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: "upstream_error",
        answer: "ИИ временно недоступен: " + (data && data.error && data.error.message ? data.error.message : upstream.status)
      });
      return;
    }

    const candidate = (data.candidates || [])[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const answer = parts.map(function (p) { return p.text || ""; }).join("").trim();

    let usedWeb = false;
    const sourcesMap = new Map();
    const groundingChunks = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
    groundingChunks.forEach(function (chunk) {
      if (chunk.web && chunk.web.uri) {
        usedWeb = true;
        if (!sourcesMap.has(chunk.web.uri)) {
          sourcesMap.set(chunk.web.uri, { title: chunk.web.title || chunk.web.uri, url: chunk.web.uri });
        }
      }
    });

    res.status(200).json({
      answer: answer || "Не получилось сформулировать ответ, попробуйте переформулировать вопрос.",
      web: usedWeb,
      sources: Array.from(sourcesMap.values()).slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: "server_error", answer: "Ошибка на сервере: " + (err && err.message ? err.message : "неизвестная") });
  }
};
