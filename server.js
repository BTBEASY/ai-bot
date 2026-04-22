require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const PORT = process.env.PORT || 10000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SITE_URL = process.env.SITE_URL || "https://btbeasy.com";
const WC_BASE = `${SITE_URL}/wp-json/wc/v3/products`;
const WP_PAGES_API = `${SITE_URL}/wp-json/wp/v2/pages`;
const WP_POSTS_API = `${SITE_URL}/wp-json/wp/v2/posts`;

const CK = process.env.WC_CK;
const CS = process.env.WC_CS;

const conversations = {};

function detectLanguage(text = "") {
  const arabicRegex = /[\u0600-\u06FF]/;
  return arabicRegex.test(text) ? "ar" : "en";
}

function normalizeText(text = "") {
  return text.toLowerCase().trim();
}

function extractBudget(text = "") {
  const match = text.match(/(\$|aed|dh|dirham|usd)?\s?(\d{2,6})/i);
  if (!match) return null;
  return Number(match[2]);
}

function detectBuyingIntent(text = "") {
  return /buy|purchase|price|cost|quote|deal|recommend|suggest|best|need|looking for|interested|order|laptop|pc|computer|monitor|server|printer|network|storage|lenovo|hp|dell|asus|gaming/i.test(
    text
  );
}

function extractCategory(text = "") {
  const t = normalizeText(text);

  if (/laptop|notebook|ultrabook|macbook/i.test(t)) return "laptop";
  if (/desktop|pc|computer|workstation/i.test(t)) return "desktop";
  if (/monitor|display|screen/i.test(t)) return "monitor";
  if (/keyboard/i.test(t)) return "keyboard";
  if (/mouse/i.test(t)) return "mouse";
  if (/printer/i.test(t)) return "printer";
  if (/server|rack server|tower server/i.test(t)) return "server";
  if (/storage|ssd|hdd|nas/i.test(t)) return "storage";
  if (/network|router|switch|wifi|access point/i.test(t)) return "network";

  return null;
}

function extractBrand(text = "") {
  const brands = [
    "lenovo",
    "hp",
    "dell",
    "asus",
    "acer",
    "msi",
    "apple",
    "canon",
    "epson",
    "logitech"
  ];

  const t = normalizeText(text);
  return brands.find((brand) => t.includes(brand)) || null;
}

function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function keepRecentMessages(history = [], maxItems = 12) {
  return history.slice(-maxItems);
}

async function fetchProducts(searchText = "") {
  const params = {
    per_page: 50,
    status: "publish"
  };

  if (searchText && searchText.trim()) {
    params.search = searchText.trim();
  }

  const response = await axios.get(WC_BASE, {
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

    const pageText = pages
      .map((p) => {
        const title = p?.title?.rendered || "";
        const excerpt = stripHtml(p?.excerpt?.rendered || "");
        const link = p?.link || "";
        return `Page: ${title}\nSummary: ${excerpt}\nLink: ${link}`;
      })
      .join("\n\n");

    const postText = posts
      .map((p) => {
        const title = p?.title?.rendered || "";
        const excerpt = stripHtml(p?.excerpt?.rendered || "");
        const link = p?.link || "";
        return `Post: ${title}\nSummary: ${excerpt}\nLink: ${link}`;
      })
      .join("\n\n");

    return `${pageText}\n\n${postText}`.trim();
  } catch (error) {
    return "";
  }
}

function scoreProducts(products, userMessage) {
  const text = normalizeText(userMessage);
  const words = text.split(/\s+/).filter(Boolean);
  const category = extractCategory(text);
  const brand = extractBrand(text);
  const budget = extractBudget(text);

  return products
    .map((p) => {
      let score = 0;

      const name = normalizeText(p.name || "");
      const shortDesc = normalizeText(stripHtml(p.short_description || ""));
      const price = Number(p.price || p.regular_price || 0);

      words.forEach((word) => {
        if (word.length > 2 && name.includes(word)) score += 3;
        if (word.length > 2 && shortDesc.includes(word)) score += 1;
      });

      if (category && name.includes(category)) score += 8;
      if (brand && name.includes(brand)) score += 8;

      if (budget && price > 0) {
        if (price <= budget) score += 6;
        if (price > budget && price <= budget * 1.15) score += 2;
      }

      if (p.stock_status === "instock") score += 2;
      if (p.featured) score += 2;

      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score);
}

function buildProductSummary(products = [], lang = "en") {
  return products
    .slice(0, 8)
    .map((p) => {
      const price = p.price || p.regular_price || "Contact for price";
      return [
        `Name: ${p.name || ""}`,
        `Price: ${price}`,
        `Stock: ${p.stock_status || "unknown"}`,
        `Link: ${p.permalink || ""}`
      ].join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt({ lang, siteKnowledge, productSummary }) {
  const isArabic = lang === "ar";

  return `
You are a professional AI sales assistant for BTB Easy, an electronics and technology store in the UAE.

Your goal:
- understand the customer's real need
- recommend the best-fit product or solution
- help the customer move toward purchase
- stay concise, natural, and persuasive
- never sound robotic

Language rule:
- Reply in ${isArabic ? "Arabic" : "English"}
- If the customer writes in Arabic, reply in Arabic
- If the customer writes in English, reply in English

Sales behavior:
- Ask smart follow-up questions when the request is unclear
- If the customer mentions budget, brand, or use case, use that directly
- Recommend at most 2 products
- Focus on value, fit, and confidence
- If the customer sounds ready, encourage the next step
- If no exact match is clear, say that you can help narrow it down

Formatting rule:
- Keep replies short and clean
- No raw JSON
- No long technical dumps
- End with a helpful question or a clear next step

Important:
- Do not invent products that are not in the product list
- Do not claim unavailable specs unless clearly present
- If product info is limited, be honest and recommend based on available data
- If the user is only greeting, greet back and ask what they need
- Do not push products too early if intent is unclear

Critical catalog rule:
- Never invent or mention any product, model, brand, price, or specification unless it exists in the provided store product list.
- If no exact match exists in the provided catalog, clearly say so.
- In that case, only offer nearby alternatives from the provided catalog.
- Never recommend outside products.
- Never continue pushing products after the customer declines.
- If the customer says "no need", "not now", "later", or similar, politely stop recommending products.


Site knowledge:
${siteKnowledge || "No extra site knowledge available."}

Available products:
${productSummary || "No product list available."}
`.trim();
}

app.get("/", (req, res) => {
  res.send("BTB Easy AI server is running");
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = (req.body.message || "").trim();
    const userId = (req.body.userId || "default").toString();
    const currentPage = (req.body.currentPage || "").toString();

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    const lang = detectLanguage(userMessage);
    const buyingIntent = detectBuyingIntent(userMessage);
    const budget = extractBudget(userMessage);
    const category = extractCategory(userMessage);
    const brand = extractBrand(userMessage);

    if (!conversations[userId]) {
      conversations[userId] = [];
    }

    conversations[userId].push({
      role: "user",
      content: userMessage
    });

    conversations[userId] = keepRecentMessages(conversations[userId], 12);

    const searchQueryParts = [userMessage, category, brand].filter(Boolean);
    const searchQuery = searchQueryParts.join(" ");

    const [products, siteKnowledge] = await Promise.all([
      fetchProducts(searchQuery),
      fetchSiteKnowledge()
    ]);

    const scoredProducts = scoreProducts(products, userMessage);
    const suggestedProducts = scoredProducts.slice(0, 2);
    const productSummary = buildProductSummary(suggestedProducts, lang);

    const systemPrompt = buildSystemPrompt({
      lang,
      siteKnowledge,
      productSummary
    });

    const contextNote = currentPage
      ? lang === "ar"
        ? `العميل حالياً في هذه الصفحة: ${currentPage}`
        : `Customer is currently on this page: ${currentPage}`
      : "";

    const aiResponse = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        ...(contextNote ? [{ role: "system", content: contextNote }] : []),
        ...conversations[userId]
      ]
    });

    const reply =
      aiResponse?.choices?.[0]?.message?.content ||
      (lang === "ar"
        ? "أستطيع مساعدتك في اختيار المنتج المناسب. ما الذي تبحث عنه بالضبط؟"
        : "I can help you choose the right product. What exactly are you looking for?");

    conversations[userId].push({
      role: "assistant",
      content: reply
    });

    conversations[userId] = keepRecentMessages(conversations[userId], 12);

    const showProducts = buyingIntent || !!category || !!brand || !!budget;

    res.json({
      reply,
      language: lang,
      showProducts,
      products: suggestedProducts.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price || p.regular_price || "",
        currency: p.currency || "",
        link: p.permalink,
        image:
          p.images && p.images[0] && p.images[0].src
            ? p.images[0].src
            : "https://via.placeholder.com/120",
        stockStatus: p.stock_status || "unknown"
      }))
    });
  } catch (err) {
    console.error("CHAT ERROR:", err.response?.data || err.message);

    res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
