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
You are a friendly and smart shopping assistant.

User message: ${userMessage}

Rules:
- Talk like a human (friendly and natural)
- If user says hi → greet and ask what they need
- Ask questions before recommending products
- Ask only ONE question at a time
- Do NOT suggest products too early
- Suggest maximum 2 products only when user intent is clear
- Keep answers short and clean
- Do NOT include product links in text
- Do NOT list full specifications

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
