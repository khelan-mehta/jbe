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

// Entry Schema
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

// Task Schema - Updated with new fields
const taskSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
  },
  completed: {
    type: Boolean,
    default: false,
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "medium",
  },
  category: {
    type: String,
    enum: ["personal", "work", "study", "health", "other"],
    default: "personal",
  },
  dueDate: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
    default: null,
  },
});

const Task = mongoose.model("Task", taskSchema);

// Password
const PASSWORD = "nalehK05@";

// Function to get philosophical critique
async function getPhilosophicalCritique(content, attempt = 1) {
  const maxAttempts = 3;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a philosophical analysis assistant. Analyze journal entries and orchestrate a deep philosophical discussion between TWO relevant philosophers.

CRITICAL: You MUST respond with ONLY valid JSON. No other text before or after. The JSON must follow this EXACT structure:

{
  "philosophers": ["Philosopher 1 Full Name", "Philosopher 2 Full Name"],
  "individualCritiques": [
    {
      "philosopher": "Philosopher 1 Full Name",
      "critique": "A thoughtful 3-4 sentence analysis of the journal entry from this philosopher's unique perspective, citing their core theories and how they apply to the situation described. Be specific about their philosophical framework."
    },
    {
      "philosopher": "Philosopher 2 Full Name", 
      "critique": "A thoughtful 3-4 sentence analysis from a contrasting philosophical perspective, highlighting how their theories offer a different lens on the same situation."
    }
  ],
  "dialogue": [
    {"speaker": "Philosopher 1 Full Name", "statement": "Opening statement responding to Philosopher 2's critique, finding points of agreement or disagreement (2-3 sentences)"},
    {"speaker": "Philosopher 2 Full Name", "statement": "Response that builds on or challenges Philosopher 1's point, introducing a new dimension to consider (2-3 sentences)"},
    {"speaker": "Philosopher 1 Full Name", "statement": "Deeper analysis that references specific concepts from their work, engaging with Philosopher 2's counterpoint (2-3 sentences)"},
    {"speaker": "Philosopher 2 Full Name", "statement": "Further development that either synthesizes both views or sharpens the distinction, bringing in their own theoretical framework (2-3 sentences)"},
    {"speaker": "Philosopher 1 Full Name", "statement": "Nuanced response that acknowledges complexity while maintaining their philosophical stance (2-3 sentences)"},
    {"speaker": "Philosopher 2 Full Name", "statement": "Builds upon the previous exchange, perhaps finding common ground or identifying irreconcilable differences (2-3 sentences)"},
    {"speaker": "Philosopher 1 Full Name", "statement": "Penultimate statement that ties their argument back to the journal entry with actionable philosophical insight (2-3 sentences)"},
    {"speaker": "Philosopher 2 Full Name", "statement": "Final response offering their concluding perspective and practical wisdom drawn from their philosophy (2-3 sentences)"}
  ],
  "resources": [
    {"title": "Short, readable article/essay on the philosophical topic at hand (5,000-15,000 words max)", "url": "https://real-accessible-url.com"},
    {"title": "Another short, accessible article/essay on the core themes discussed (5,000-15,000 words max)", "url": "https://real-accessible-url.com"}
  ]
}

IMPORTANT: The "dialogue" array MUST contain at least 8 objects with "speaker" and "statement" fields. Each "statement" must be a non-empty string.

Guidelines:
- Choose philosophers whose actual theories directly relate to the themes
- Individual critiques should clearly reflect each philosopher's unique theoretical framework
- The dialogue should feel like a genuine intellectual conversation
- Arguments should progressively deepen, not repeat
- Reference specific philosophical concepts
- Provide EXACTLY 2 short, accessible resources (articles/essays)
- NO explanatory text outside the JSON structure`,
        },
        {
          role: "user",
          content: `Analyze this journal entry philosophically. First, have each philosopher provide their individual critique. Then, create a dialogue where they discuss and build upon each other's perspectives. Provide exactly 2 short, readable resources (articles/essays that can be read in a day) related to the philosophical themes discussed. Respond with ONLY the JSON structure:\n\n${content}`,
        },
      ],
      max_tokens: 2500,
      temperature: 0.7,
    });

    const responseText = completion.choices[0].message.content.trim();

    // Try to extract JSON if there's extra text
    let jsonText = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const result = JSON.parse(jsonText);

    // Validate the structure
    if (
      !result.philosophers ||
      !Array.isArray(result.philosophers) ||
      result.philosophers.length !== 2
    ) {
      throw new Error("Invalid philosophers array");
    }
    if (
      !result.individualCritiques ||
      !Array.isArray(result.individualCritiques) ||
      result.individualCritiques.length !== 2
    ) {
      throw new Error("Invalid individual critiques array");
    }
    if (
      !result.dialogue ||
      !Array.isArray(result.dialogue) ||
      result.dialogue.length < 2
    ) {
      throw new Error("Invalid dialogue array");
    }

    // Validate dialogue structure
    for (const exchange of result.dialogue) {
      if (
        !exchange.speaker ||
        !exchange.statement ||
        typeof exchange.statement !== "string" ||
        exchange.statement.trim() === ""
      ) {
        throw new Error(
          "Invalid dialogue structure - missing speaker or statement"
        );
      }
    }

    if (!result.resources || !Array.isArray(result.resources)) {
      throw new Error("Invalid resources array");
    }

    return result;
  } catch (error) {
    console.error(
      `OpenAI API Error (Attempt ${attempt}/${maxAttempts}):`,
      error.message
    );

    // Retry logic
    if (attempt < maxAttempts) {
      console.log(`Retrying... (Attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return getPhilosophicalCritique(content, attempt + 1);
    }

    // After 3 failed attempts, return error response
    console.error(
      `Failed to generate philosophical critique after ${maxAttempts} attempts`
    );
    return {
      philosophers: ["System", "Error"],
      individualCritiques: [
        {
          philosopher: "System",
          critique: `Failed to generate philosophical critique after ${maxAttempts} attempts. The AI service may be experiencing issues. Please try again later or check your API configuration.`,
        },
      ],
      dialogue: [],
      resources: [],
    };
  }
}

// Task Routes

// Get all tasks
app.get("/api/tasks", async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// Create new task
app.post("/api/tasks", async (req, res) => {
  try {
    const { text, priority, category, dueDate } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Task text is required" });
    }

    const task = new Task({
      text: text.trim(),
      priority: priority || "medium",
      category: category || "personal",
      dueDate: dueDate || null,
      completed: false,
      createdAt: new Date(),
    });

    await task.save();
    res.status(201).json(task);
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ error: "Failed to create task" });
  }
});

// Update task
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { completed, text, priority, category, dueDate } = req.body;

    const updateData = {};

    if (text !== undefined) updateData.text = text;
    if (priority !== undefined) updateData.priority = priority;
    if (category !== undefined) updateData.category = category;
    if (dueDate !== undefined) updateData.dueDate = dueDate;

    if (completed !== undefined) {
      updateData.completed = completed;
      updateData.completedAt = completed ? new Date() : null;
    }

    const task = await Task.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(task);
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ error: "Failed to update task" });
  }
});

// Delete task
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ message: "Task deleted successfully" });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

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
      critique: JSON.stringify({
        individualCritiques: philosophicalAnalysis.individualCritiques,
        dialogue: philosophicalAnalysis.dialogue,
      }),
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
        critique: JSON.stringify({
          individualCritiques: philosophicalAnalysis.individualCritiques,
          dialogue: philosophicalAnalysis.dialogue,
        }),
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
