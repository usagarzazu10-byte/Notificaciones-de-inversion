// ============================================================
// invnotif backend
// Se ejecuta periódicamente (vía GitHub Actions) para:
//  1. Leer las empresas seguidas desde Supabase
//  2. Buscar noticias nuevas de cada una (Google News RSS, gratis)
//  3. Clasificar importancia: reglas por palabras clave + IA (Claude)
//     como refuerzo en los casos ambiguos
//  4. Guardar las noticias nuevas en Supabase
//  5. Enviar notificación push a los dispositivos suscritos si es
//     importante
// ============================================================

import { createClient } from "@supabase/supabase-js";
import Parser from "rss-parser";
import webpush from "web-push";
import crypto from "node:crypto";

// ---- Config / credenciales (vienen de variables de entorno / secrets) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // opcional pero recomendado
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:example@example.com";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const parser = new Parser({ timeout: 15000 });

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ---- Palabras clave para la clasificación por reglas ----
// Si aparece alguna de estas -> importancia ALTA directa (sin gastar IA)
const STRONG_KEYWORDS = [
  "quiebra", "bancarrota", "despidos masivos", "escándalo", "hackeo",
  "ciberataque", "investigación", "demanda colectiva", "dimite", "renuncia",
  "destituido", "fraude", "sanción millonaria", "multa millonaria",
  "caída histórica", "desplome", "recall", "retirada de producto",
  "opa hostil", "adquisición", "fusión", "resultados récord",
  "beneficios récord", "salida a bolsa", "ipo", "quiebra técnica",
  "profit warning", "advertencia de beneficios", "recompra de acciones",
];

// Si aparece alguna de estas pero ninguna "strong" -> caso ambiguo,
// se consulta a la IA como refuerzo
const WEAK_KEYWORDS = [
  "resultados trimestrales", "beneficios", "ingresos", "acciones", "dividendo",
  "previsión", "guidance", "cotización", "mercado", "inversores", "junta",
  "ceo", "producto", "lanzamiento", "contrato", "acuerdo", "regulador",
  "sec", "cnmv",
];

function textMatchesAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k));
}

function dedupeKey(url, title) {
  return crypto.createHash("sha256").update(url + "|" + title).digest("hex");
}

async function classifyWithClaude(title, summary) {
  if (!ANTHROPIC_API_KEY) return null; // sin key, nos quedamos con la regla por defecto (low)
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content:
              `Eres un analista financiero. Clasifica si esta noticia es IMPORTANTE ` +
              `(afecta materialmente la cotización, reputación o negocio de la empresa) ` +
              `o NO IMPORTANTE (rutinaria, ruido, marketing menor).\n\n` +
              `Título: ${title}\nResumen: ${summary || "(sin resumen)"}\n\n` +
              `Responde SOLO con JSON, sin texto adicional, con este formato exacto: ` +
              `{"importance": "high" | "low", "reason": "<motivo breve en español, máx 15 palabras>"}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("Error Anthropic API:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data.content?.map((b) => b.text || "").join("").trim();
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (parsed.importance === "high" || parsed.importance === "low") return parsed;
    return null;
  } catch (err) {
    console.error("Fallo clasificando con Claude:", err.message);
    return null;
  }
}

async function classify(title, summary) {
  const strongHits = textMatchesAny(title + " " + (summary || ""), STRONG_KEYWORDS);
  if (strongHits.length > 0) {
    return { importance: "high", score: strongHits.length, reason: `Palabra(s) clave: ${strongHits.join(", ")}` };
  }
  const weakHits = textMatchesAny(title + " " + (summary || ""), WEAK_KEYWORDS);
  if (weakHits.length > 0) {
    const aiResult = await classifyWithClaude(title, summary);
    if (aiResult) {
      return { importance: aiResult.importance, score: weakHits.length, reason: `IA: ${aiResult.reason}` };
    }
    // Sin IA disponible: caso ambiguo se queda como baja por defecto
    return { importance: "low", score: weakHits.length, reason: "Ambiguo, sin IA disponible -> baja por defecto" };
  }
  return { importance: "low", score: 0, reason: "Sin coincidencias relevantes" };
}

async function fetchNewsForCompany(company) {
  // Google News RSS: gratis, sin API key, en español
  const q = encodeURIComponent(company.search_terms.split("|")[0]);
  const url = `https://news.google.com/rss/search?q=${q}&hl=es&gl=ES&ceid=ES:es`;
  try {
    const feed = await parser.parseURL(url);
    return feed.items || [];
  } catch (err) {
    console.error(`Error leyendo RSS de ${company.name}:`, err.message);
    return [];
  }
}

async function sendPushToAll(payload) {
  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error || !subs) return;
  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    } catch (err) {
      console.error("Push fallido para un dispositivo (puede que ya no exista):", err.message);
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }
}

async function main() {
  const { data: companies, error: companiesErr } = await supabase
    .from("companies")
    .select("*")
    .eq("active", true);

  if (companiesErr) {
    console.error("Error leyendo empresas:", companiesErr.message);
    process.exit(1);
  }

  let totalNew = 0;

  for (const company of companies || []) {
    const items = await fetchNewsForCompany(company);
    for (const item of items) {
      const title = item.title || "";
      const url = item.link || "";
      if (!title || !url) continue;

      const key = dedupeKey(url, title);

      // Ya existe -> saltar
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("dedupe_key", key)
        .maybeSingle();
      if (existing) continue;

      const summary = (item.contentSnippet || "").slice(0, 500);
      const result = await classify(title, summary);
      const sourceName = item.creator || (item.source && item.source.title) || new URL(url).hostname;

      const { error: insertErr } = await supabase.from("notifications").insert({
        company_id: company.id,
        title,
        summary,
        source_name: sourceName,
        source_url: url,
        published_at: item.isoDate || new Date().toISOString(),
        importance: result.importance,
        importance_score: result.score,
        importance_reason: result.reason,
        dedupe_key: key,
      });

      if (insertErr) {
        console.error("Error insertando noticia:", insertErr.message);
        continue;
      }

      totalNew++;

      if (result.importance === "high") {
        await sendPushToAll({
          title: `${company.name}: noticia importante`,
          body: title,
          url,
        });
      }
    }
  }

  await supabase.from("settings").update({ last_check_at: new Date().toISOString() }).eq("id", 1);

  console.log(`Comprobación completa. ${totalNew} noticias nuevas guardadas.`);
}

main();
