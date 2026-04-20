<<<<<<< HEAD
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(express.json());
app.use(cors());


// 🔑 API ها
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const WC_URL = "https://btbeasy.com/wp-json/wc/v3/products";
const CK = "ck_68a06bbbef12b008a74af9278b500c3cd500344f";
const CS = "cs_6b6e6f655a74659d1b42e51118fd30b12d3728c0";

// 📩 مسیر چت
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    // 1️⃣ گرفتن محصولات از ووکامرس
    const response = await axios.get(WC_URL, {
      params: {
        consumer_key: CK,
        consumer_secret: CS,
        per_page: 5
      }
    });

    const products = response.data;

    // 2️⃣ خلاصه محصولات
    const productList = products.map(p =>
      `${p.name} - ${p.price} AED`
    ).join("\n");

    // 3️⃣ درخواست به AI
    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are a sales assistant for an electronics store in Dubai.
Recommend products with price and short benefits.
Encourage user to buy or go to WhatsApp.
          `
        },
        {
          role: "user",
          content: `User: ${userMessage}\nProducts:\n${productList}`
        }
      ]
    });

    const reply = ai.choices[0].message.content;

    res.json({ reply });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "error" });
  }
});

app.listen(3000, () => {
  console.log("AI Server running on 3000 🚀");
=======
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(express.json());
app.use(cors());


// 🔑 API ها
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const WC_URL = "https://btbeasy.com/wp-json/wc/v3/products";
const CK = "ck_68a06bbbef12b008a74af9278b500c3cd500344f";
const CS = "cs_6b6e6f655a74659d1b42e51118fd30b12d3728c0";

// 📩 مسیر چت
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    // 1️⃣ گرفتن محصولات از ووکامرس
    const response = await axios.get(WC_URL, {
      params: {
        consumer_key: CK,
        consumer_secret: CS,
        per_page: 5
      }
    });

    const products = response.data;

    // 2️⃣ خلاصه محصولات
    const productList = products.map(p =>
      `${p.name} - ${p.price} AED`
    ).join("\n");

    // 3️⃣ درخواست به AI
    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are a sales assistant for an electronics store in Dubai.
Recommend products with price and short benefits.
Encourage user to buy or go to WhatsApp.
          `
        },
        {
          role: "user",
          content: `User: ${userMessage}\nProducts:\n${productList}`
        }
      ]
    });

    const reply = ai.choices[0].message.content;

    res.json({ reply });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "error" });
  }
});

app.listen(3000, () => {
  console.log("AI Server running on 3000 🚀");
>>>>>>> 76d3e999c0f0bad9972ea12822bc9c6d460a4316
});