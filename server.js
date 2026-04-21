require('dotenv').config();

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

    // گرفتن محصولات
    const wcRes = await axios.get(WC_URL, {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${CK}:${CS}`).toString("base64")
      }
    });

    const products = wcRes.data.slice(0, 10); // فقط 10 تا

    // ساخت prompt
    const productList = products.map(p => p.name).join("\n");

    const prompt = `
User wants: ${userMessage}

Here are products:
${productList}

Suggest best options.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    res.json({
      reply: completion.choices[0].message.content
    });

  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
