const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://Khelan05:KrxRwjRwkhgYUdwh@cluster0.c6y9phd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// Entry Schema - Updated to include philosophical debate
const entrySchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
  },
  content: {
    type: String,
    required: true,
  },
  critique: {
    type: String,
    default: "",
  },
  philosophers: {
    type: Array,
    default: [],
  },
  resources: {
    type: Array,
    default: [],
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const Entry = mongoose.model("Entry", entrySchema);

// Password
const PASSWORD = "nalehK05@";

// Function to get philosophical debate and critique
async function getPhilosophicalCritique(content) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a philosophical analysis assistant. Analyze journal entries and create intellectual debates between TWO relevant philosophers who have written about the themes present.

Your response MUST follow this EXACT JSON structure:
{
  "philosophers": ["Philosopher 1 Name", "Philosopher 2 Name"],
  "debate": [
    {"speaker": "Philosopher 1 Name", "argument": "First argument from Philosopher 1"},
    {"speaker": "Philosopher 2 Name", "argument": "Counter-argument from Philosopher 2"},
    {"speaker": "Philosopher 1 Name", "argument": "Second argument from Philosopher 1"},
    {"speaker": "Philosopher 2 Name", "argument": "Second counter-argument"},
    {"speaker": "Philosopher 1 Name", "argument": "Third argument"},
    {"speaker": "Philosopher 2 Name", "argument": "Third counter-argument"},
    {"speaker": "Philosopher 1 Name", "argument": "Fourth argument"},
    {"speaker": "Philosopher 2 Name", "argument": "Fourth counter-argument"},
    {"speaker": "Philosopher 1 Name", "argument": "Fifth and final argument"},
    {"speaker": "Philosopher 2 Name", "argument": "Fifth and final counter-argument"}
  ],
  "resources": [
    {"title": "Primary work by Philosopher 1", "url": "real accessible URL"},
    {"title": "Primary work by Philosopher 2", "url": "real accessible URL"},
    {"title": "Stanford Encyclopedia entry or academic article", "url": "real URL"},
    {"title": "Additional relevant resource", "url": "real URL"}
  ]
}

Guidelines:
- Choose philosophers whose actual theories directly relate to the themes
- Each argument should be 2-3 sentences, directly addressing the journal entry's themes
- Arguments should build on each other, creating a genuine philosophical dialogue
- Resources must be real, accessible URLs (Stanford Encyclopedia, Internet Archive, academic repositories)
- Focus on: ethics, existentialism, meaning, identity, relationships, or other relevant philosophical domains`,
        },
        {
          role: "user",
          content: `Analyze this journal entry and create a philosophical debate:\n\n${content}`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result;
  } catch (error) {
    console.error("OpenAI API Error:", error);
    return {
      philosophers: ["Error", "Error"],
      debate: [
        {
          speaker: "System",
          argument:
            "Unable to generate philosophical critique. Please check your OpenAI API configuration.",
        },
      ],
      resources: [],
    };
  }
}

// Routes

// Authentication
app.post("/api/authenticate", (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Get all entries
app.get("/api/entries", async (req, res) => {
  try {
    const entries = await Entry.find().sort({ date: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

// Create new entry with philosophical critique
app.post("/api/entries", async (req, res) => {
  try {
    const { content, date } = req.body;

    const existingEntry = await Entry.findOne({ date });
    if (existingEntry) {
      return res
        .status(400)
        .json({ error: "Entry for this date already exists" });
    }

    const philosophicalAnalysis = await getPhilosophicalCritique(content);

    const entry = new Entry({
      date,
      content,
      critique: JSON.stringify(philosophicalAnalysis.debate),
      philosophers: philosophicalAnalysis.philosophers,
      resources: philosophicalAnalysis.resources,
      timestamp: new Date(),
    });

    await entry.save();
    res.status(201).json(entry);
  } catch (error) {
    console.error("Error creating entry:", error);
    res.status(500).json({ error: "Failed to create entry" });
  }
});

// Update entry with new philosophical critique
app.put("/api/entries/:id", async (req, res) => {
  try {
    const { content } = req.body;

    const philosophicalAnalysis = await getPhilosophicalCritique(content);

    const entry = await Entry.findByIdAndUpdate(
      req.params.id,
      {
        content,
        critique: JSON.stringify(philosophicalAnalysis.debate),
        philosophers: philosophicalAnalysis.philosophers,
        resources: philosophicalAnalysis.resources,
        timestamp: new Date(),
      },
      { new: true }
    );

    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }

    res.json(entry);
  } catch (error) {
    console.error("Error updating entry:", error);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// Delete entry
app.delete("/api/entries/:id", async (req, res) => {
  try {
    const entry = await Entry.findByIdAndDelete(req.params.id);

    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }

    res.json({ message: "Entry deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
