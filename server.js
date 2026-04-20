require('dotenv').config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(cors());

// ✅ OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ WooCommerce API
const WC_URL = "https://btbeasy.com/wp-json/wc/v3/products";

// ⚠️ اینا رو بعدا ببر داخل .env (فعلا تست ok)
const CK = process.env.WC_CK;
const CS = process.env.WC_CS;
console.log("CK:", CK);
console.log("CS:", CS);

// ✅ Health check
app.get("/", (req, res) => {
  res.send("AI Bot is running 🚀");
});

// ✅ Chat API
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    // 🛒 گرفتن محصولات
    const response = await axios.get(WC_URL, {
      params: {
        consumer_key: CK,
        consumer_secret: CS,
        per_page: 5
      }
    });

    const products = response.data;

    const productList = products.map(p =>
      `${p.name} - ${p.price} AED`
    ).join("\n");

    // 🤖 OpenAI
    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional sales assistant for an electronics store in Dubai.
Always recommend products clearly with price.
Keep answers short and persuasive.
Encourage user to buy or contact on WhatsApp.`
        },
        {
          role: "user",
          content: `User: ${userMessage}\n\nProducts:\n${productList}`
        }
      ]
    });

    const reply = ai.choices[0].message.content;

    res.json({ reply });

  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
