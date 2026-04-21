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

Sales behavior:
- When user intent is clear → suggest 2 products MAX
- Compare them briefly (why this vs that)
- Highlight value (performance, price, deal)
- Speak like you're helping them make a smart decision
- If user is close to buying → gently push them to decide
- Help the user feel confident about the choice
- Reduce hesitation (price, performance, value)

- If user shows buying intent (e.g. "ok", "I like this", "good") → 
  offer to provide purchase link

- Always guide user to the NEXT step (decide, compare, or buy)

Format:
- First: short friendly explanation
- Then: product suggestions (clean, not messy)
- No long specs
- No raw links in text
- Make product suggestions easy to scan (clean lines)
- Use short benefit-focused sentences
- End with a small question or suggestion (to continue or close sale)

Important:
- Do NOT overwhelm user with too much information
- Focus on helping user make a decision quickly
- Your goal is not just to inform, but to convert the user into a buyer

Available products:
${productList}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
  { role: "system", content: prompt },
  ...conversations[userId]
]
    });
conversations[userId].push({
  role: "assistant",
  content: completion.choices[0].message.content
});
   res.json({
  reply: completion.choices[0].message.content,
 products: products.map(p => ({
  name: p.name,
  price: p.price || p.regular_price || p.sale_price || "N/A",
  link: p.permalink
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
