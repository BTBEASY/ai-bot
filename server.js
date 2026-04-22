require('dotenv').config();
let conversations = {};
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());
app.use(cors());

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// WooCommerce
const WC_URL = "https://btbeasy.com/wp-json/wc/v3/products";
const CK = process.env.WC_CK;
const CS = process.env.WC_CS;

// تست ساده
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// چت
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const isBuyingIntent = /laptop|gaming|buy|price|budget|lenovo|hp|pc|computer/i.test(userMessage);
    const userId = req.body.userId || "default";

if (!conversations[userId]) {
  conversations[userId] = [];
}

conversations[userId].push({
  role: "user",
  content: userMessage
});

    // گرفتن محصولات
    const wcRes = await axios.get(WC_URL, {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${CK}:${CS}`).toString("base64")
      }
    });

    const products = wcRes.data.slice(0, 10); // فقط 10 تا

    // ساخت prompt
    const productList = products.map(p => {
  return `
Name: ${p.name}
Price: ${p.price}
Link: ${p.permalink}
`;
}).join("\n");
    const smartProductList = isBuyingIntent ? productList : "";

const prompt = `
You are a professional sales assistant for an electronics store.

Your job is to HELP the customer choose the best product and guide them to buy.


Style:
- Talk naturally like a friendly expert (not robotic)
- Be slightly persuasive (like a real salesperson)
- Show confidence in suggestions
- Keep it short but helpful

Conversation rules:
- Remember previous messages and context
- Do NOT repeat greetings
- Do NOT reset conversation
- If user gives budget or brand → use it directly

CRITICAL RULE:
- If user message is casual (like "hi", "hello") → ONLY greet and ask what they need
- DO NOT suggest ANY product yet

Sales behavior:
- ONLY suggest products when user intent is CLEAR
- When suggesting → show MAX 2 products
- Compare them briefly (why this vs that)
- Highlight value (performance, price, deal)
- Speak like you're helping them make a smart decision
- If user is close to buying → gently push

Buying trigger:
- If user shows buying intent ("ok", "I like this", "good") → offer purchase link

Format:
- First: short friendly explanation
- Then: product suggestions (clean and simple)
- No long specs
- No raw links in text
- Use short benefit-focused sentences
- End with a question to continue conversation

Important:
- Do NOT overwhelm user
- Focus on helping user decide fast
- Your goal is to convert user into buyer

IMPORTANT OUTPUT RULE:

- If user is just greeting or unclear → DO NOT suggest products
- If user shows interest, budget, or asks about products → suggest products

- Also decide internally:
  showProducts = true or false

- If NOT ready → just talk, ask questions
- If READY → suggest max 2 products


Available products:
${smartProductList}
`;
 const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: prompt },
    ...conversations[userId]
  ]
});

// ✅ متن AI
const aiText = completion.choices[0].message.content;
    

// ✅ intent
const buyingIntent = /buy|purchase|yes|ok|sure|interested/i.test(userMessage);
const aiSuggesting = /recommend|suggest|option|perfect|best|good choice/i.test(aiText);
const showProducts = buyingIntent || aiSuggesting;

// ✅ کلمات کاربر
const text = userMessage.toLowerCase();

let category = null;

if (text.includes("laptop")) category = "laptop";
else if (text.includes("monitor")) category = "monitor";
else if (text.includes("keyboard")) category = "keyboard";
else if (text.includes("mouse")) category = "mouse";
const keywords = userMsgLower.split(" ");

// ✅ اسکور محصولات
let scoredProducts = products.map(p => {
  let score = 0;
  const name = (p.name || "").toLowerCase();

  keywords.forEach(k => {
    if (name.includes(k)) score += 2;
  });

  if (/laptop|gaming/.test(userMsgLower) && /laptop|gaming/.test(name)) score += 5;
  if (/monitor/.test(userMsgLower) && /monitor|display/.test(name)) score += 5;
  if (/keyboard|mouse|accessory/.test(userMsgLower) && /keyboard|mouse|usb/.test(name)) score += 5;

  return { ...p, score };
});

// ✅ مرتب سازی
scoredProducts.sort((a, b) => b.score - a.score);

// ✅ انتخاب بهترین‌ها
let finalProducts = products;

if (category) {
  finalProducts = products.filter(p =>
    p.name.toLowerCase().includes(category)
  );
}
    finalProducts = scoredProducts.slice(0, 3);

// ✅ ذخیره مکالمه
conversations[userId].push({
  role: "assistant",
  content: aiText
});

// ✅ خروجی
res.json({
  reply: aiText,
  showProducts: showProducts,
  products: finalProducts.map(p => ({
    name: p.name,
    price: p.price || p.regular_price || "",
    link: p.permalink,
    image: (p.images && p.images[0] && p.images[0].src)
      ? p.images[0].src
      : "https://via.placeholder.com/80"
  }))
});

  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
