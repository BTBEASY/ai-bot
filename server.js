require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(cors());

const PORT = process.env.PORT || 10000;
const SITE_URL = process.env.SITE_URL || "https://btbeasy.com";
const WC_BASE_URL = `${SITE_URL}/wp-json/wc/v3/products`;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const conversations = Object.create(null);
const catalogCache = {
  data: [],
  fetchedAt: 0
};

const CACHE_TTL_MS = 3 * 60 * 1000;

function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function containsArabic(text = "") {
  return /[\u0600-\u06FF]/.test(text);
}

function detectLanguage(text = "") {
  return containsArabic(text) ? "ar" : "en";
}

function stripHtml(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getConversation(userId) {
  if (!conversations[userId]) {
    conversations[userId] = [];
  }
  return conversations[userId];
}

function trimConversation(history, max = 12) {
  return history.slice(-max);
}

function detectDeclineIntent(text = "") {
  const t = normalizeText(text);
  return /no need|not now|later|stop|no thanks|thanks|thank you|i'm good|not interested/.test(t);
}

function detectMoreIntent(text = "") {
  const t = normalizeText(text);
  return /more|other options|other models|show more|anything else|another option/.test(t);
}

function extractBudget(text = "") {
  const cleaned = String(text).replace(/,/g, "");
  const match = cleaned.match(/(?:aed|usd|\$|dhs?|dirham)?\s*(\d{2,6})/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractQuotedModel(text = "") {
  const normalized = String(text);
  const exactModel = normalized.match(/\b([a-z0-9]{2,}[-][a-z0-9-]+)\b/i);
  return exactModel ? exactModel[1].toLowerCase() : null;
}

function tokenize(text = "") {
  return normalizeText(text)
    .split(/[^a-z0-9\u0600-\u06FF"+.-]+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length > 1);
}

function detectRequestedCategory(text = "") {
  const t = normalizeText(text);

  if (/monitor|display|screen/.test(t)) return "monitor";
  if (/laptop|notebook|ultrabook|macbook/.test(t)) return "laptop";
  if (/desktop|pc|computer|workstation/.test(t)) return "desktop";
  if (/keyboard/.test(t)) return "keyboard";
  if (/mouse/.test(t)) return "mouse";
  if (/printer/.test(t)) return "printer";
  if (/server/.test(t)) return "server";
  if (/ssd|hdd|storage|nas/.test(t)) return "storage";
  if (/router|switch|wifi|network|access point/.test(t)) return "network";

  return null;
}

function parseUserFilters(text = "") {
  const raw = normalizeText(text);
  const tokens = tokenize(text);
  const budget = extractBudget(text);
  const exactModel = extractQuotedModel(text);
  const requestedCategory = detectRequestedCategory(text);

  const knownBrands = [
    "hp", "dell", "lenovo", "acer", "asus", "msi", "apple",
    "samsung", "lg", "logitech", "canon", "epson", "intel", "amd"
  ];

  const brand = knownBrands.find((b) => raw.includes(b)) || null;

  const sizeMatches = [...String(text).matchAll(/(\d{2,3}(?:\.\d+)?)\s?(?:inch|in|")/gi)].map((m) => m[1]);
  const refreshMatches = [...String(text).matchAll(/(\d{2,3})\s?hz/gi)].map((m) => m[1]);
  const ramMatches = [...String(text).matchAll(/(\d{1,3})\s?gb\s?ram/gi)].map((m) => m[1]);
  const storageMatches = [...String(text).matchAll(/(\d{3,4}|\d)\s?(tb|gb)\s?(ssd|hdd)?/gi)].map((m) => `${m[1]} ${m[2]} ${m[3] || ""}`.trim());

  const specHints = [];
  if (/gaming/.test(raw)) specHints.push("gaming");
  if (/office|business|work/.test(raw)) specHints.push("business");
  if (/design|editing|render|graphics/.test(raw)) specHints.push("graphics");
  if (/ips/.test(raw)) specHints.push("ips");
  if (/fhd|1080/.test(raw)) specHints.push("fhd");
  if (/qhd|2k/.test(raw)) specHints.push("qhd");
  if (/4k|uhd/.test(raw)) specHints.push("4k");
  if (/ssd/.test(raw)) specHints.push("ssd");
  if (/hdd/.test(raw)) specHints.push("hdd");
  if (/wireless/.test(raw)) specHints.push("wireless");
  if (/rgb/.test(raw)) specHints.push("rgb");

  return {
    budget,
    brand,
    exactModel,
    requestedCategory,
    sizes: sizeMatches,
    refreshRates: refreshMatches,
    ram: ramMatches,
    storage: storageMatches,
    specHints,
    tokens
  };
}

async function fetchAllProducts() {
  const now = Date.now();
  if (catalogCache.data.length && now - catalogCache.fetchedAt < CACHE_TTL_MS) {
    return catalogCache.data;
  }

  const all = [];
  let page = 1;

  while (true) {
    const response = await axios.get(WC_BASE_URL, {
      auth: {
        username: process.env.WC_CK,
        password: process.env.WC_CS
      },
      params: {
        per_page: 100,
        page,
        status: "publish"
      },
      timeout: 20000
    });

    const rows = Array.isArray(response.data) ? response.data : [];
    all.push(...rows);

    if (rows.length < 100) break;
    page += 1;
    if (page > 20) break;
  }

  catalogCache.data = all;
  catalogCache.fetchedAt = now;
  return all;
}

function productText(product) {
  const attrs = Array.isArray(product.attributes)
    ? product.attributes.map((a) => {
        const values = Array.isArray(a.options) ? a.options.join(" ") : "";
        return `${a.name || ""} ${values}`;
      }).join(" ")
    : "";

  const cats = Array.isArray(product.categories)
    ? product.categories.map((c) => c.name || "").join(" ")
    : "";

  const tags = Array.isArray(product.tags)
    ? product.tags.map((t) => t.name || "").join(" ")
    : "";

  return normalizeText([
    product.name || "",
    stripHtml(product.short_description || ""),
    stripHtml(product.description || ""),
    attrs,
    cats,
    tags,
    product.sku || ""
  ].join(" "));
}

function productMatchesCategory(product, requestedCategory) {
  if (!requestedCategory) return true;

  const haystack = productText(product);

  const categoryMap = {
    monitor: ["monitor", "display", "screen"],
    laptop: ["laptop", "notebook", "ultrabook", "macbook"],
    desktop: ["desktop", "pc", "computer", "workstation"],
    keyboard: ["keyboard"],
    mouse: ["mouse"],
    printer: ["printer"],
    server: ["server"],
    storage: ["ssd", "hdd", "storage", "nas"],
    network: ["router", "switch", "wifi", "network", "access point"]
  };

  const keywords = categoryMap[requestedCategory] || [requestedCategory];
  return keywords.some((keyword) => haystack.includes(keyword));
}

function scoreProduct(product, filters) {
  const text = productText(product);
  let score = 0;

  if (product.stock_status === "instock") score += 5;
  if (product.featured) score += 2;

  if (filters.exactModel && text.includes(filters.exactModel)) score += 50;
  if (filters.brand && text.includes(filters.brand)) score += 12;

  for (const token of filters.tokens) {
    if (token.length < 2) continue;
    if (text.includes(token)) score += 3;
  }

  for (const s of filters.sizes) {
    if (text.includes(`${s} inch`) || text.includes(`${s}"`) || text.includes(`${s} in`)) score += 10;
    if (text.includes(s)) score += 2;
  }

  for (const hz of filters.refreshRates) {
    if (text.includes(`${hz}hz`) || text.includes(`${hz} hz`)) score += 8;
  }

  for (const ram of filters.ram) {
    if (text.includes(`${ram}gb ram`) || text.includes(`${ram} gb ram`)) score += 8;
  }

  for (const st of filters.storage) {
    if (text.includes(normalizeText(st))) score += 8;
  }

  for (const hint of filters.specHints) {
    if (text.includes(hint)) score += 8;
  }

  const price = Number(product.price || product.regular_price || 0);
  if (filters.budget && price > 0) {
    if (price <= filters.budget) score += 10;
    else if (price <= filters.budget * 1.15) score += 4;
    else score -= 5;
  }

  return score;
}

function rankProducts(products, filters) {
  return products
    .map((product) => ({
      product,
      score: scoreProduct(product, filters)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

function buildShortProductList(rows, limit) {
  return rows.slice(0, limit).map(({ product }, index) => {
    const attrs = Array.isArray(product.attributes)
      ? product.attributes.slice(0, 4).map((a) => {
          const values = Array.isArray(a.options) ? a.options.join(", ") : "";
          return `${a.name}: ${values}`;
        }).join(" | ")
      : "";

    return [
      `Product ${index + 1}`,
      `Name: ${product.name || ""}`,
      `Price: ${product.price || product.regular_price || "N/A"}`,
      `SKU: ${product.sku || ""}`,
      `Stock: ${product.stock_status || ""}`,
      `Attributes: ${attrs}`,
      `Link: ${product.permalink || ""}`
    ].join("\n");
  }).join("\n\n");
}

function mapClientProducts(rows, limit) {
  return rows.slice(0, limit).map(({ product }) => ({
    id: product.id,
    name: product.name || "",
    price: product.price || product.regular_price || "",
    currency: product.currency || "",
    link: product.permalink || "",
    image: product.images && product.images[0] ? product.images[0].src : "https://via.placeholder.com/120?text=Product",
    stockStatus: product.stock_status || "unknown"
  }));
}

function needsClarifyingQuestion(filters, moreIntent) {
  if (moreIntent) return false;
  if (filters.exactModel) return false;
  if (filters.budget) return false;
  if (filters.sizes.length) return false;
  if (filters.refreshRates.length) return false;
  if (filters.ram.length) return false;
  if (filters.storage.length) return false;
  if (filters.brand) return false;
  if (filters.specHints.length) return false;
  return true;
}

function buildClarifyingQuestion(lang, requestedCategory) {
  if (requestedCategory === "monitor") {
    return lang === "ar"
      ? "أكيد. ما الحجم أو الاستخدام الذي تريده للشاشة، مثل مكتب أو ألعاب، وهل لديك ميزانية محددة؟"
      : "Sure. What monitor size or use case do you want, like office or gaming, and do you have a budget in mind?";
  }

  if (requestedCategory === "laptop") {
    return lang === "ar"
      ? "أكيد. هل تريده للعمل أم للألعاب، وهل لديك ميزانية أو علامة تجارية مفضلة؟"
      : "Sure. Is it for business or gaming, and do you have a budget or preferred brand?";
  }

  return lang === "ar"
    ? "أكيد. ما العلامة التجارية أو الموديل أو المواصفات أو الميزانية التي تبحث عنها؟"
    : "Sure. What brand, model, specs, or budget are you looking for?";
}

function buildSystemPrompt(lang, productList, totalMatches, moreIntent, requestedCategory) {
  const replyLanguage = lang === "ar" ? "Arabic" : "English";

  return `
You are a professional AI sales assistant for an electronics store in the UAE.

Rules:
- Reply only in ${replyLanguage}
- Only talk about products that exist in the provided store results
- Never invent products, model names, brands, specs, prices, or links
- Never recommend outside products
- Never switch to a different category than the customer's requested category
- If the customer asked for ${requestedCategory || "a product"}, only discuss that category
- Keep the reply short and sales-helpful
- Let the UI display product cards
- Do not paste raw links
- If the customer asked for more options, acknowledge that politely
- Do not say these are the only products in the store unless the server explicitly says so

Store result count:
${totalMatches}

More intent:
${moreIntent ? "yes" : "no"}

Requested category:
${requestedCategory || "not explicit"}

Store results:
${productList}
`.trim();
}

app.get("/", (req, res) => {
  res.send("BTB Easy AI server is running");
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = String(req.body.message || "").trim();
    const userId = String(req.body.userId || "default");

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    const lang = detectLanguage(userMessage);
    const declineIntent = detectDeclineIntent(userMessage);
    const moreIntent = detectMoreIntent(userMessage);
    const filters = parseUserFilters(userMessage);

    const history = getConversation(userId);
    history.push({ role: "user", content: userMessage });

    if (declineIntent) {
      const reply = lang === "ar"
        ? "بكل سرور. إذا احتجت أي مساعدة لاحقاً فأنا هنا."
        : "Of course. If you need any help later, I am here.";
      history.push({ role: "assistant", content: reply });
      conversations[userId] = trimConversation(history);
      return res.json({ reply, language: lang, showProducts: false, products: [] });
    }

    if (needsClarifyingQuestion(filters, moreIntent)) {
      const reply = buildClarifyingQuestion(lang, filters.requestedCategory);
      history.push({ role: "assistant", content: reply });
      conversations[userId] = trimConversation(history);
      return res.json({ reply, language: lang, showProducts: false, products: [] });
    }

    const products = await fetchAllProducts();

    const categoryLockedProducts = filters.requestedCategory
      ? products.filter((product) => productMatchesCategory(product, filters.requestedCategory))
      : products;

    const ranked = rankProducts(categoryLockedProducts, filters);
    const totalMatches = ranked.length;
    const limit = moreIntent ? 6 : 3;
    const topResults = ranked.slice(0, limit);

    if (!topResults.length) {
      const reply = filters.requestedCategory
        ? (lang === "ar"
            ? `عذراً، لم أجد منتجاً مطابقاً ضمن فئة ${filters.requestedCategory} في مخزوننا الحالي.`
            : `Sorry, I could not find a matching ${filters.requestedCategory} in our current catalog.`)
        : (lang === "ar"
            ? "عذراً، لم أجد منتجاً مطابقاً في مخزوننا الحالي. هل تريد علامة تجارية أو مواصفات أو ميزانية مختلفة؟"
            : "Sorry, I could not find a matching product in our current catalog. Would you like another brand, spec, or budget?");

      history.push({ role: "assistant", content: reply });
      conversations[userId] = trimConversation(history);

      return res.json({
        reply,
        language: lang,
        showProducts: false,
        products: []
      });
    }

    const prompt = buildSystemPrompt(
      lang,
      buildShortProductList(topResults, limit),
      totalMatches,
      moreIntent,
      filters.requestedCategory
    );

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: prompt },
        ...trimConversation(history)
      ]
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      (lang === "ar"
        ? "وجدت لك بعض الخيارات المناسبة من متجرنا."
        : "I found some suitable options from our store.");

    history.push({ role: "assistant", content: reply });
    conversations[userId] = trimConversation(history);

    return res.json({
      reply,
      language: lang,
      showProducts: true,
      products: mapClientProducts(topResults, limit)
    });
  } catch (error) {
    console.error("CHAT ERROR:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
