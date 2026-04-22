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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const WC_BASE_URL = `${SITE_URL}/wp-json/wc/v3/products`;
const WP_PAGES_API = `${SITE_URL}/wp-json/wp/v2/pages`;
const WP_POSTS_API = `${SITE_URL}/wp-json/wp/v2/posts`;

const CK = process.env.WC_CK;
const CS = process.env.WC_CS;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const conversations = Object.create(null);

function normalizeText(text = "") {
  return String(text).toLowerCase().trim();
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

function keepRecentMessages(history = [], maxItems = 12) {
  return history.slice(-maxItems);
}

function extractBudget(text = "") {
  const cleaned = text.replace(/,/g, "");
  const match = cleaned.match(/(?:aed|dhs?|dirhams?|usd|\$)?\s*(\d{2,6})/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectBuyingIntent(text = "") {
  const t = normalizeText(text);
  return /buy|purchase|price|cost|quote|deal|recommend|suggest|best|need|looking for|interested|order|laptop|pc|computer|monitor|server|printer|network|storage|gaming|business|office/i.test(t);
}

function detectDeclineIntent(text = "") {
  const t = normalizeText(text);
  return /no need|not now|later|maybe later|stop|enough|no thanks|thanks|thank you|i'm good|not interested/i.test(t);
}

function extractBrand(text = "") {
  const t = normalizeText(text);
  const brands = [
    "lenovo",
    "hp",
    "dell",
    "acer",
    "asus",
    "msi",
    "apple",
    "samsung",
    "lg",
    "canon",
    "epson",
    "logitech"
  ];

  return brands.find((brand) => t.includes(brand)) || null;
}

function extractCategory(text = "") {
  const t = normalizeText(text);

  if (/laptop|notebook|ultrabook|macbook/.test(t)) return "laptop";
  if (/gaming laptop|gaming notebook/.test(t)) return "gaming laptop";
  if (/business laptop|office laptop/.test(t)) return "business laptop";
  if (/desktop|pc|computer|workstation/.test(t)) return "desktop";
  if (/monitor|display|screen/.test(t)) return "monitor";
  if (/keyboard/.test(t)) return "keyboard";
  if (/mouse/.test(t)) return "mouse";
  if (/printer/.test(t)) return "printer";
  if (/server/.test(t)) return "server";
  if (/ssd|hdd|storage|nas/.test(t)) return "storage";
  if (/router|switch|wifi|network|access point/.test(t)) return "network";

  return null;
}

function extractUseCase(text = "") {
  const t = normalizeText(text);

  if (/gaming|game|esports/.test(t)) return "gaming";
  if (/business|office|work|company/.test(t)) return "business";
  if (/design|editing|render|video|graphics/.test(t)) return "creative";
  if (/student|study|school|college/.test(t)) return "student";

  return null;
}

function getFallbackImage() {
  return "https://via.placeholder.com/120?text=Product";
}

async function fetchProducts(search = "") {
  const params = {
    per_page: 50,
    status: "publish"
  };

  if (search && search.trim()) {
    params.search = search.trim();
  }

  const response = await axios.get(WC_BASE_URL, {
    params,
    auth: {
      username: CK,
      password: CS
    },
    timeout: 15000
  });

  return Array.isArray(response.data) ? response.data : [];
}

async function fetchSiteKnowledge() {
  try {
    const [pagesRes, postsRes] = await Promise.all([
      axios.get(WP_PAGES_API, {
        params: { per_page: 5, _fields: "title,excerpt,link" },
        timeout: 10000
      }),
      axios.get(WP_POSTS_API, {
        params: { per_page: 5, _fields: "title,excerpt,link" },
        timeout: 10000
      })
    ]);

    const pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];
    const posts = Array.isArray(postsRes.data) ? postsRes.data : [];

    const pageText = pages.map((item) => {
      const title = item?.title?.rendered || "";
      const excerpt = stripHtml(item?.excerpt?.rendered || "");
      return `Page: ${title}\nSummary: ${excerpt}\nLink: ${item?.link || ""}`;
    }).join("\n\n");

    const postText = posts.map((item) => {
      const title = item?.title?.rendered || "";
      const excerpt = stripHtml(item?.excerpt?.rendered || "");
      return `Post: ${title}\nSummary: ${excerpt}\nLink: ${item?.link || ""}`;
    }).join("\n\n");

    return [pageText, postText].filter(Boolean).join("\n\n");
  } catch (error) {
    return "";
  }
}

function buildSearchQuery(userMessage, category, brand, useCase) {
  return [userMessage, category, brand, useCase].filter(Boolean).join(" ");
}

function scoreProducts(products, userMessage) {
  const text = normalizeText(userMessage);
  const words = text.split(/\s+/).filter(Boolean);
  const budget = extractBudget(text);
  const category = extractCategory(text);
  const brand = extractBrand(text);
  const useCase = extractUseCase(text);

  return products.map((product) => {
    let score = 0;

    const name = normalizeText(product.name || "");
    const desc = normalizeText(stripHtml(product.short_description || ""));
    const categories = Array.isArray(product.categories)
      ? product.categories.map((c) => normalizeText(c.name || "")).join(" ")
      : "";
    const combined = `${name} ${desc} ${categories}`;

    words.forEach((word) => {
      if (word.length > 2 && combined.includes(word)) score += 2;
    });

    if (category) {
      if (category === "gaming laptop") {
        if (combined.includes("laptop")) score += 4;
        if (combined.includes("gaming")) score += 8;
      } else if (category === "business laptop") {
        if (combined.includes("laptop")) score += 4;
        if (combined.includes("business") || combined.includes("office")) score += 8;
      } else if (combined.includes(category)) {
        score += 8;
      }
    }

    if (brand && combined.includes(brand)) {
      score += 8;
    }

    if (useCase) {
      if (useCase === "gaming" && /gaming|rtx|gtx|radeon|geforce/.test(combined)) score += 8;
      if (useCase === "business" && /business|office|productivity|vostro|thinkpad|v15/.test(combined)) score += 8;
      if (useCase === "creative" && /creator|design|graphics|rtx|oled/.test(combined)) score += 8;
      if (useCase === "student" && /student|everyday|lightweight|portable/.test(combined)) score += 6;
    }

    const price = Number(product.price || product.regular_price || 0);
    if (budget && price > 0) {
      if (price <= budget) score += 6;
      else if (price <= budget * 1.15) score += 2;
      else score -= 2;
    }

    if (product.stock_status === "instock") score += 3;
    if (product.featured) score += 2;

    return {
      ...product,
      score
    };
  }).sort((a, b) => b.score - a.score);
}

function splitProductsByBudget(products, budget) {
  if (!budget) {
    return {
      exact: products.filter((p) => p.score > 0),
      near: []
    };
  }

  const exact = [];
  const near = [];

  for (const product of products) {
    const price = Number(product.price || product.regular_price || 0);
    if (!price || product.score <= 0) continue;

    if (price <= budget) {
      exact.push(product);
    } else if (price <= budget * 1.2) {
      near.push(product);
    }
  }

  return { exact, near };
}

function formatCatalogForPrompt(products = []) {
  return products.slice(0, 4).map((p, index) => {
    const price = p.price || p.regular_price || "N/A";
    const stock = p.stock_status || "unknown";
    const categories = Array.isArray(p.categories)
      ? p.categories.map((c) => c.name).filter(Boolean).join(", ")
      : "";

    return [
      `Store Product ${index + 1}:`,
      `Name: ${p.name || ""}`,
      `Price: ${price}`,
      `Stock: ${stock}`,
      `Categories: ${categories}`,
      `Short Description: ${stripHtml(p.short_description || "")}`,
      `Link: ${p.permalink || ""}`
    ].join("\n");
  }).join("\n\n");
}

function buildSystemPrompt({ lang, siteKnowledge, exactCatalog, nearCatalog, hasExact, hasNear }) {
  const replyLanguage = lang === "ar" ? "Arabic" : "English";

  return `
You are a professional AI sales assistant for BTB Easy, an electronics and technology store in the UAE.

Language rule:
- Reply only in ${replyLanguage}

Main goal:
- Help the customer choose from our store catalog only
- Never recommend outside products
- Never invent model names, prices, links, specifications, brands, or availability

Critical catalog rules:
- You may only refer to products that appear in the provided store catalog
- If there is no exact match in the exact-match catalog, say that clearly and apologize briefly
- If near alternatives are available, offer those from our store only
- If nothing suitable is available, say so honestly and ask whether the customer wants another category, brand, or budget
- If the customer declines or says they do not need more help, stop recommending products

Chat output rules:
- Keep your reply short
- Do not include raw links
- Do not include markdown bullet lists
- Do not list detailed specs
- Do not print product names unless they exist in the provided catalog
- If exact-match products exist, say you found a few suitable options from our store
- If only near alternatives exist, apologize briefly and say you found a few nearby options from our store
- If no products exist, apologize and ask one short follow-up question
- Let the UI display the product cards

Behavior:
- Be natural, concise, and sales-helpful
- Ask at most one short follow-up question when needed
- Never contradict the store catalog
- Never mix categories
- If the user asked for a laptop, do not talk about monitors unless you are explicitly offering a nearby alternative because no laptop match exists

Site knowledge:
${siteKnowledge || "No extra site knowledge available."}

Exact-match catalog:
${hasExact ? exactCatalog : "No exact-match store products found."}

Nearby alternatives catalog:
${hasNear ? nearCatalog : "No nearby alternative store products found."}
`.trim();
}

function buildContextNote(currentPage, lang) {
  if (!currentPage) return "";
  return lang === "ar"
    ? `العميل موجود حالياً في هذه الصفحة: ${currentPage}`
    : `Customer is currently on this page: ${currentPage}`;
}

function buildNoMatchReply(lang) {
  return lang === "ar"
    ? "عذراً، لم أجد منتجاً مطابقاً تماماً في مخزوننا الحالي. إذا أردت، أستطيع أن أقترح أقرب الخيارات المتوفرة لدينا."
    : "Sorry, I could not find an exact match in our current catalog. If you want, I can suggest the closest available options from our store.";
}

function buildNoProductReply(lang) {
  return lang === "ar"
    ? "عذراً، لا أرى حالياً منتجاً مناسباً في مخزوننا لهذا الطلب. هل تفضّل ميزانية مختلفة أو فئة أخرى؟"
    : "Sorry, I do not currently see a suitable product in our store for that request. Would you like a different budget or another category?";
}

function mapProductsForClient(products = []) {
  return products.slice(0, 2).map((p) => ({
    id: p.id,
    name: p.name || "",
    price: p.price || p.regular_price || "",
    currency: p.currency || "",
    link: p.permalink || "",
    image: p.images && p.images[0] && p.images[0].src ? p.images[0].src : getFallbackImage(),
    stockStatus: p.stock_status || "unknown"
  }));
}

app.get("/", (req, res) => {
  res.send("BTB Easy AI server is running");
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = String(req.body.message || "").trim();
    const userId = String(req.body.userId || "default");
    const currentPage = String(req.body.currentPage || "").trim();

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    const lang = detectLanguage(userMessage);
    const category = extractCategory(userMessage);
    const brand = extractBrand(userMessage);
    const useCase = extractUseCase(userMessage);
    const budget = extractBudget(userMessage);
    const declineIntent = detectDeclineIntent(userMessage);
    const buyingIntent = detectBuyingIntent(userMessage);

    if (!conversations[userId]) {
      conversations[userId] = [];
    }

    conversations[userId].push({
      role: "user",
      content: userMessage
    });

    conversations[userId] = keepRecentMessages(conversations[userId], 12);

    if (declineIntent) {
      const declineReply = lang === "ar"
        ? "بكل سرور. إذا احتجت أي مساعدة لاحقاً، أنا هنا."
        : "Of course. If you need anything later, I am here to help.";

      conversations[userId].push({
        role: "assistant",
        content: declineReply
      });

      return res.json({
        reply: declineReply,
        language: lang,
        showProducts: false,
        products: []
      });
    }

    const searchQuery = buildSearchQuery(userMessage, category, brand, useCase);

    const [products, siteKnowledge] = await Promise.all([
      fetchProducts(searchQuery),
      fetchSiteKnowledge()
    ]);

    const scoredProducts = scoreProducts(products, userMessage);
    const { exact, near } = splitProductsByBudget(scoredProducts, budget);

    const exactProducts = exact.slice(0, 2);
    const nearProducts = near.slice(0, 2);

    const hasExact = exactProducts.length > 0;
    const hasNear = nearProducts.length > 0;

    const chosenProducts = hasExact ? exactProducts : nearProducts;

    let reply = "";
    let showProducts = false;

    if (!buyingIntent && !category && !brand && !budget && !useCase) {
      reply = lang === "ar"
        ? "أكيد، أستطيع مساعدتك. ما نوع المنتج الذي تبحث عنه؟"
        : "Sure, I can help. What type of product are you looking for?";
    } else if (!hasExact && !hasNear) {
      reply = buildNoProductReply(lang);
    } else {
      const exactCatalog = formatCatalogForPrompt(exactProducts);
      const nearCatalog = formatCatalogForPrompt(nearProducts);

      const systemPrompt = buildSystemPrompt({
        lang,
        siteKnowledge,
        exactCatalog,
        nearCatalog,
        hasExact,
        hasNear
      });

      const contextNote = buildContextNote(currentPage, lang);

      const aiResponse = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          ...(contextNote ? [{ role: "system", content: contextNote }] : []),
          ...conversations[userId]
        ]
      });

      reply = aiResponse?.choices?.[0]?.message?.content?.trim() || "";

      if (!reply) {
        reply = hasExact
          ? (lang === "ar"
              ? "وجدت لك بعض الخيارات المناسبة من متجرنا."
              : "I found a few suitable options from our store.")
          : buildNoMatchReply(lang);
      }

      showProducts = chosenProducts.length > 0;
    }

    conversations[userId].push({
      role: "assistant",
      content: reply
    });

    conversations[userId] = keepRecentMessages(conversations[userId], 12);

    res.json({
      reply,
      language: lang,
      showProducts,
      products: showProducts ? mapProductsForClient(chosenProducts) : []
    });
  } catch (error) {
    console.error("CHAT ERROR:", error.response?.data || error.message);

    res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
