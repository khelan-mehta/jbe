const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const OpenAI = require("openai");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v2: cloudinary } = require("cloudinary");
require("dotenv").config();

const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dcqwmz7v3",
  api_key: process.env.CLOUDINARY_API_KEY || "473698288756698",
  api_secret:
    process.env.CLOUDINARY_API_SECRET || "xmqW-rwLKHP38L8vgagC55Oo5KM",
});

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

const NodeCache = require("node-cache");

// Initialize cache with 1 hour TTL (time to live)
const cache = new NodeCache({
  stdTTL: 3600, // 1 hour in seconds
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false, // Don't clone objects for better performance
});

// Cache keys constants
const CACHE_KEYS = {
  ROADMAP: "roadmap_all",
  STATS: "learning_stats",
  TOPIC: (dayNumber) => `topic_${dayNumber}`,
  GENERATED_CONTENT: (dayNumber) => `generated_${dayNumber}`,
};

// Middleware to check cache
const cacheMiddleware = (keyGenerator, ttl = 3600) => {
  return (req, res, next) => {
    const key =
      typeof keyGenerator === "function" ? keyGenerator(req) : keyGenerator;

    const cachedData = cache.get(key);

    if (cachedData) {
      console.log(`✅ Cache HIT for key: ${key}`);
      return res.json(cachedData);
    }

    console.log(`❌ Cache MISS for key: ${key}`);

    // Store the original json method
    res.originalJson = res.json;

    // Override json method to cache the response
    res.json = function (data) {
      cache.set(key, data, ttl);
      console.log(`💾 Cached data for key: ${key}`);
      return res.originalJson(data);
    };

    next();
  };
};

// Helper function to invalidate related caches
const invalidateCache = (patterns) => {
  const keys = cache.keys();
  patterns.forEach((pattern) => {
    const matchedKeys = keys.filter((key) => key.includes(pattern));
    matchedKeys.forEach((key) => {
      cache.del(key);
      console.log(`🗑️  Invalidated cache: ${key}`);
    });
  });
};

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

// Personal Memory Schema
const personalMemorySchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
  },
  text: {
    type: String,
    default: "",
  },
  imageUrl: {
    type: String,
    default: null,
  },
  imagePublicId: {
    // Add this new field
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const PersonalMemory = mongoose.model("PersonalMemory", personalMemorySchema);

// Configure multer for file uploads
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed!"));
  },
});

async function uploadToCloudinary(fileBuffer, filename) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "personal-memories",
        public_id: `memory-${Date.now()}`,
        resource_type: "auto",
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
}

async function deleteFromCloudinary(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
  }
}

// Serve uploaded images
app.use("/uploads", express.static("uploads"));

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

// Add these schemas after the Task schema in your backend

// Learning Topic Schema
const learningTopicSchema = new mongoose.Schema({
  dayNumber: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 30,
  },
  title: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    enum: [
      "scalability",
      "database",
      "caching",
      "messaging",
      "networking",
      "security",
      "architecture",
    ],
    default: "architecture",
  },
  completed: {
    type: Boolean,
    default: false,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  content: {
    overview: { type: String, default: "" },
    keyComponents: { type: Array, default: [] },
    implementation: { type: String, default: "" },
    realWorldExamples: { type: Array, default: [] },
    codeExample: { type: String, default: "" },
    bestPractices: { type: Array, default: [] },
    commonPitfalls: { type: Array, default: [] },
    resources: { type: Array, default: [] },
  },
  notes: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const LearningTopic = mongoose.model("LearningTopic", learningTopicSchema);

// 30-day System Design Roadmap
const SYSTEM_DESIGN_ROADMAP = [
  { day: 1, title: "Load Balancing Fundamentals", category: "scalability" },
  { day: 2, title: "Horizontal vs Vertical Scaling", category: "scalability" },
  { day: 3, title: "Database Sharding", category: "database" },
  {
    day: 4,
    title: "Database Replication & Master-Slave Architecture",
    category: "database",
  },
  {
    day: 5,
    title: "Caching Strategies (Redis, Memcached)",
    category: "caching",
  },
  { day: 6, title: "Content Delivery Networks (CDN)", category: "networking" },
  { day: 7, title: "Message Queues (RabbitMQ, Kafka)", category: "messaging" },
  { day: 8, title: "Microservices Architecture", category: "architecture" },
  { day: 9, title: "API Gateway Patterns", category: "architecture" },
  {
    day: 10,
    title: "Database Indexing & Query Optimization",
    category: "database",
  },
  {
    day: 11,
    title: "CAP Theorem & Distributed Systems",
    category: "architecture",
  },
  { day: 12, title: "Event-Driven Architecture", category: "architecture" },
  { day: 13, title: "Rate Limiting & Throttling", category: "scalability" },
  { day: 14, title: "Consistent Hashing", category: "architecture" },
  { day: 15, title: "Database Partitioning Strategies", category: "database" },
  {
    day: 16,
    title: "NoSQL Databases (MongoDB, Cassandra, DynamoDB)",
    category: "database",
  },
  {
    day: 17,
    title: "WebSockets & Real-Time Communication",
    category: "networking",
  },
  {
    day: 18,
    title: "Authentication & Authorization (OAuth, JWT)",
    category: "security",
  },
  {
    day: 19,
    title: "Service Discovery & Health Checks",
    category: "architecture",
  },
  { day: 20, title: "Circuit Breaker Pattern", category: "architecture" },
  { day: 21, title: "Data Warehousing & OLAP vs OLTP", category: "database" },
  {
    day: 22,
    title: "Search Systems (Elasticsearch, Lucene)",
    category: "database",
  },
  {
    day: 23,
    title: "Distributed Transactions & Two-Phase Commit",
    category: "database",
  },
  {
    day: 24,
    title: "Blob Storage & Object Storage (S3)",
    category: "database",
  },
  {
    day: 25,
    title: "Monitoring & Observability (Prometheus, Grafana)",
    category: "architecture",
  },
  {
    day: 26,
    title: "Containerization & Orchestration (Docker, Kubernetes)",
    category: "architecture",
  },
  {
    day: 27,
    title: "Stream Processing (Kafka Streams, Flink)",
    category: "messaging",
  },
  { day: 28, title: "GraphQL vs REST Architecture", category: "architecture" },
  {
    day: 29,
    title: "Disaster Recovery & Backup Strategies",
    category: "architecture",
  },
  {
    day: 30,
    title: "System Design Case Study: Design Twitter/Instagram",
    category: "architecture",
  },
];

// Function to generate comprehensive learning content using OpenAI
async function generateLearningContent(topic, attempt = 1) {
  const maxAttempts = 3;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert system design instructor with deep knowledge of distributed systems, scalability, and software architecture. Create comprehensive, production-ready learning materials for software engineers.

CRITICAL: Respond with ONLY valid JSON. No other text before or after. Follow this EXACT structure:

{
  "overview": "A detailed 4-5 paragraph explanation covering: what this concept is, why it's important, when to use it, and its place in modern system architecture. Be thorough and technical.",
  "keyComponents": [
    "Component 1: Brief description of its role",
    "Component 2: Brief description of its role",
    "Component 3: Brief description of its role"
  ],
  "implementation": "A detailed 5-6 paragraph technical deep-dive into HOW this is implemented. Include: architecture diagrams in text form, data flow, specific technologies/tools used, configuration examples, and step-by-step implementation approach. Be extremely detailed and practical.",
  "realWorldExamples": [
    {
      "company": "Company Name",
      "implementation": "2-3 sentences describing their specific implementation, scale, and results. Include numbers/metrics when possible.",
      "techniqueUsed": "Specific technique or variation they used"
    },
    {
      "company": "Another Company",
      "implementation": "2-3 sentences with concrete details about their approach",
      "techniqueUsed": "Their specific implementation details"
    },
    {
      "company": "Third Company",
      "implementation": "Real-world details of their system",
      "techniqueUsed": "Technology stack and approach"
    }
  ],
  "codeExample": "A complete, production-quality code example (150-300 lines) that demonstrates the concept. Include:\n- Language: Node.js/Python/Java (choose most appropriate)\n- Full working implementation with error handling\n- Detailed comments explaining each section\n- Configuration and setup code\n- Example usage\n- Testing considerations\nMake it realistic and runnable.",
  "bestPractices": [
    "Best practice 1: Detailed explanation of why this matters and how to implement it",
    "Best practice 2: Technical guidance with specific recommendations",
    "Best practice 3: Production considerations and optimization tips",
    "Best practice 4: Security/performance/scalability consideration",
    "Best practice 5: Monitoring and maintenance guidance"
  ],
  "commonPitfalls": [
    "Pitfall 1: Description of the mistake and how to avoid it with technical details",
    "Pitfall 2: Common anti-pattern and the correct approach",
    "Pitfall 3: Performance/scalability issue and solution",
    "Pitfall 4: Security vulnerability and mitigation"
  ],
  "resources": [
    {
      "title": "Technical paper/documentation title",
      "url": "https://real-url.com",
      "type": "Paper/Documentation/Tutorial"
    },
    {
      "title": "Another resource title",
      "url": "https://real-url.com",
      "type": "Blog/Video/Course"
    },
    {
      "title": "Third resource",
      "url": "https://real-url.com",
      "type": "Resource type"
    }
  ]
}

Guidelines:
- Be extremely detailed and technical
- Include real metrics, numbers, and scale information
- Provide production-ready code, not toy examples
- Reference specific technologies and tools
- Include concrete implementation steps
- Make it comprehensive enough for someone to actually implement this
- Focus on practical, real-world applications
- NO explanatory text outside the JSON structure`,
        },
        {
          role: "user",
          content: `Create comprehensive learning material for: "${topic.title}". This is Day ${topic.dayNumber} of a 30-day system design course. Make it extremely detailed, practical, and production-ready. Include real-world examples from major tech companies, complete code implementations, and actionable guidance. Respond with ONLY the JSON structure.`,
        },
      ],
      max_tokens: 4000,
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
    if (!result.overview || typeof result.overview !== "string") {
      throw new Error("Invalid overview");
    }
    if (!result.implementation || typeof result.implementation !== "string") {
      throw new Error("Invalid implementation");
    }
    if (!result.codeExample || typeof result.codeExample !== "string") {
      throw new Error("Invalid code example");
    }
    if (
      !Array.isArray(result.keyComponents) ||
      result.keyComponents.length === 0
    ) {
      throw new Error("Invalid key components");
    }
    if (
      !Array.isArray(result.realWorldExamples) ||
      result.realWorldExamples.length === 0
    ) {
      throw new Error("Invalid real world examples");
    }
    if (
      !Array.isArray(result.bestPractices) ||
      result.bestPractices.length === 0
    ) {
      throw new Error("Invalid best practices");
    }
    if (
      !Array.isArray(result.commonPitfalls) ||
      result.commonPitfalls.length === 0
    ) {
      throw new Error("Invalid common pitfalls");
    }
    if (!Array.isArray(result.resources)) {
      throw new Error("Invalid resources");
    }

    return result;
  } catch (error) {
    console.error(
      `OpenAI API Error (Attempt ${attempt}/${maxAttempts}):`,
      error.message
    );

    if (attempt < maxAttempts) {
      console.log(`Retrying... (Attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return generateLearningContent(topic, attempt + 1);
    }

    // After 3 failed attempts, return error response
    console.error(
      `Failed to generate learning content after ${maxAttempts} attempts`
    );
    return {
      overview: `Failed to generate content after ${maxAttempts} attempts. Please try again later.`,
      keyComponents: [],
      implementation: "Content generation failed. Please retry.",
      realWorldExamples: [],
      codeExample: "// Content generation failed",
      bestPractices: [],
      commonPitfalls: [],
      resources: [],
    };
  }
}

// Learning Routes

// Initialize roadmap (call this once to populate the database)
app.post("/api/learning/initialize", async (req, res) => {
  try {
    // Check if already initialized
    const existingTopics = await LearningTopic.countDocuments();
    if (existingTopics > 0) {
      return res.status(400).json({ error: "Roadmap already initialized" });
    }

    // Create all 30 topics
    const topics = SYSTEM_DESIGN_ROADMAP.map((item) => ({
      dayNumber: item.day,
      title: item.title,
      category: item.category,
      completed: false,
      content: {
        overview: "",
        keyComponents: [],
        implementation: "",
        realWorldExamples: [],
        codeExample: "",
        bestPractices: [],
        commonPitfalls: [],
        resources: [],
      },
    }));

    await LearningTopic.insertMany(topics);
    res.status(201).json({
      message: "Roadmap initialized successfully",
      count: topics.length,
    });
  } catch (error) {
    console.error("Error initializing roadmap:", error);
    res.status(500).json({ error: "Failed to initialize roadmap" });
  }
});

app.get(
  "/api/learning/roadmap",
  cacheMiddleware(CACHE_KEYS.ROADMAP, 3600), // Cache for 1 hour
  async (req, res) => {
    try {
      const topics = await LearningTopic.find().sort({ dayNumber: 1 });
      res.json(topics);
    } catch (error) {
      console.error("Error fetching roadmap:", error);
      res.status(500).json({ error: "Failed to fetch roadmap" });
    }
  }
);

// Get specific topic details - WITH CACHE
app.get(
  "/api/learning/topic/:dayNumber",
  cacheMiddleware((req) => CACHE_KEYS.TOPIC(req.params.dayNumber), 3600),
  async (req, res) => {
    try {
      const topic = await LearningTopic.findOne({
        dayNumber: parseInt(req.params.dayNumber),
      });

      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      res.json(topic);
    } catch (error) {
      console.error("Error fetching topic:", error);
      res.status(500).json({ error: "Failed to fetch topic" });
    }
  }
);

// Get learning statistics - WITH CACHE
app.get(
  "/api/learning/stats",
  cacheMiddleware(CACHE_KEYS.STATS, 300), // Cache for 5 minutes
  async (req, res) => {
    try {
      const total = await LearningTopic.countDocuments();
      const completed = await LearningTopic.countDocuments({ completed: true });
      const inProgress = total - completed;

      const categoryCounts = await LearningTopic.aggregate([
        {
          $group: {
            _id: "$category",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$completed", true] }, 1, 0] },
            },
          },
        },
      ]);

      const recentlyCompleted = await LearningTopic.find({ completed: true })
        .sort({ completedAt: -1 })
        .limit(5);

      res.json({
        total,
        completed,
        inProgress,
        percentage: Math.round((completed / total) * 100),
        byCategory: categoryCounts,
        recentlyCompleted,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch statistics" });
    }
  }
);

// Generate content - INVALIDATE CACHE AFTER
app.post("/api/learning/generate/:dayNumber", async (req, res) => {
  try {
    const dayNumber = parseInt(req.params.dayNumber);
    const topic = await LearningTopic.findOne({ dayNumber });

    if (!topic) {
      return res.status(404).json({ error: "Topic not found" });
    }

    // Check if content already exists
    if (topic.content.overview && topic.content.overview.length > 100) {
      return res.status(400).json({
        error: "Content already generated for this topic",
        message: "Use the update endpoint to regenerate",
      });
    }

    console.log(
      `Generating content for Day ${topic.dayNumber}: ${topic.title}`
    );

    const generatedContent = await generateLearningContent(topic);

    topic.content = generatedContent;
    await topic.save();

    // Invalidate related caches
    invalidateCache([
      CACHE_KEYS.TOPIC(dayNumber),
      CACHE_KEYS.ROADMAP,
      CACHE_KEYS.STATS,
    ]);

    res.json(topic);
  } catch (error) {
    console.error("Error generating content:", error);
    res.status(500).json({ error: "Failed to generate content" });
  }
});

// Mark topic as completed - INVALIDATE CACHE AFTER
app.put("/api/learning/complete/:dayNumber", async (req, res) => {
  try {
    const { completed, notes } = req.body;
    const dayNumber = parseInt(req.params.dayNumber);

    const topic = await LearningTopic.findOneAndUpdate(
      { dayNumber },
      {
        completed: completed !== undefined ? completed : true,
        completedAt: completed ? new Date() : null,
        ...(notes !== undefined && { notes }),
      },
      { new: true }
    );

    if (!topic) {
      return res.status(404).json({ error: "Topic not found" });
    }

    // Invalidate related caches
    invalidateCache([
      CACHE_KEYS.TOPIC(dayNumber),
      CACHE_KEYS.ROADMAP,
      CACHE_KEYS.STATS,
    ]);

    res.json(topic);
  } catch (error) {
    console.error("Error updating topic:", error);
    res.status(500).json({ error: "Failed to update topic" });
  }
});

// Update topic notes - INVALIDATE CACHE AFTER
app.put("/api/learning/notes/:dayNumber", async (req, res) => {
  try {
    const { notes } = req.body;
    const dayNumber = parseInt(req.params.dayNumber);

    const topic = await LearningTopic.findOneAndUpdate(
      { dayNumber },
      { notes },
      { new: true }
    );

    if (!topic) {
      return res.status(404).json({ error: "Topic not found" });
    }

    // Invalidate related caches
    invalidateCache([CACHE_KEYS.TOPIC(dayNumber), CACHE_KEYS.ROADMAP]);

    res.json(topic);
  } catch (error) {
    console.error("Error updating notes:", error);
    res.status(500).json({ error: "Failed to update notes" });
  }
});

// Cache management endpoints (optional - for debugging/admin)
app.get("/api/cache/stats", (req, res) => {
  const stats = cache.getStats();
  res.json({
    keys: cache.keys().length,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: stats.hits / (stats.hits + stats.misses) || 0,
    keyList: cache.keys(),
  });
});

app.delete("/api/cache/clear", (req, res) => {
  cache.flushAll();
  res.json({ message: "Cache cleared successfully" });
});

app.delete("/api/cache/clear/:pattern", (req, res) => {
  const pattern = req.params.pattern;
  invalidateCache([pattern]);
  res.json({ message: `Cache cleared for pattern: ${pattern}` });
});

// Reset all progress (use with caution)
app.post("/api/learning/reset", async (req, res) => {
  try {
    await LearningTopic.updateMany(
      {},
      {
        completed: false,
        completedAt: null,
        notes: "",
      }
    );

    res.json({ message: "All progress reset successfully" });
  } catch (error) {
    console.error("Error resetting progress:", error);
    res.status(500).json({ error: "Failed to reset progress" });
  }
});



// Personal Memory Routes

// Get all personal memories
app.get("/api/personal-memories", async (req, res) => {
  try {
    const memories = await PersonalMemory.find().sort({ date: -1 });
    res.json(memories);
  } catch (error) {
    console.error("Error fetching memories:", error);
    res.status(500).json({ error: "Failed to fetch memories" });
  }
});

// Get a single personal memory by ID
app.get("/api/personal-memories/:id", async (req, res) => {
  try {
    const memory = await PersonalMemory.findById(req.params.id);
    
    if (!memory) {
      return res.status(404).json({ error: "Memory not found" });
    }
    
    res.json(memory);
  } catch (error) {
    console.error("Error fetching memory:", error);
    res.status(500).json({ error: "Failed to fetch memory" });
  }
});

// Get personal memory by date
app.get("/api/personal-memories/date/:date", async (req, res) => {
  try {
    const memory = await PersonalMemory.findOne({ date: req.params.date });
    
    if (!memory) {
      return res.status(404).json({ error: "Memory not found for this date" });
    }
    
    res.json(memory);
  } catch (error) {
    console.error("Error fetching memory:", error);
    res.status(500).json({ error: "Failed to fetch memory" });
  }
});

// Get memories by date range
app.get("/api/personal-memories/range/:startDate/:endDate", async (req, res) => {
  try {
    const { startDate, endDate } = req.params;
    
    const memories = await PersonalMemory.find({
      date: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ date: -1 });
    
    res.json(memories);
  } catch (error) {
    console.error("Error fetching memories:", error);
    res.status(500).json({ error: "Failed to fetch memories" });
  }
});

// Get recent memories (last N memories)
app.get("/api/personal-memories/recent/:limit", async (req, res) => {
  try {
    const limit = parseInt(req.params.limit) || 10;
    
    const memories = await PersonalMemory.find()
      .sort({ date: -1 })
      .limit(limit);
    
    res.json(memories);
  } catch (error) {
    console.error("Error fetching recent memories:", error);
    res.status(500).json({ error: "Failed to fetch recent memories" });
  }
});

// Get memories with images only
app.get("/api/personal-memories/with-images", async (req, res) => {
  try {
    const memories = await PersonalMemory.find({
      imageUrl: { $ne: null }
    }).sort({ date: -1 });
    
    res.json(memories);
  } catch (error) {
    console.error("Error fetching memories with images:", error);
    res.status(500).json({ error: "Failed to fetch memories with images" });
  }
});

// Search memories by text
app.get("/api/personal-memories/search/:query", async (req, res) => {
  try {
    const query = req.params.query;
    
    const memories = await PersonalMemory.find({
      text: { $regex: query, $options: 'i' } // Case-insensitive search
    }).sort({ date: -1 });
    
    res.json(memories);
  } catch (error) {
    console.error("Error searching memories:", error);
    res.status(500).json({ error: "Failed to search memories" });
  }
});

app.post("/api/personal-memories", upload.single("image"), async (req, res) => {
  try {
    const { date, text } = req.body;

    const existingMemory = await PersonalMemory.findOne({ date });
    if (existingMemory) {
      return res
        .status(400)
        .json({ error: "Memory for this date already exists" });
    }

    const memoryData = {
      date,
      text: text || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Upload to Cloudinary if image exists
    if (req.file) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname
      );
      memoryData.imageUrl = uploadResult.secure_url;
      memoryData.imagePublicId = uploadResult.public_id;
    }

    const memory = new PersonalMemory(memoryData);
    await memory.save();
    res.status(201).json(memory);
  } catch (error) {
    console.error("Error creating memory:", error);
    res.status(500).json({ error: "Failed to create memory" });
  }
});

// Update the Update personal memory endpoint
app.put(
  "/api/personal-memories/:id",
  upload.single("image"),
  async (req, res) => {
    try {
      const { text } = req.body;
      const memory = await PersonalMemory.findById(req.params.id);

      if (!memory) {
        return res.status(404).json({ error: "Memory not found" });
      }

      const updateData = {
        text: text !== undefined ? text : memory.text,
        updatedAt: new Date(),
      };

      // Handle new image upload
      if (req.file) {
        // Delete old image from Cloudinary if it exists
        if (memory.imagePublicId) {
          await deleteFromCloudinary(memory.imagePublicId);
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          req.file.originalname
        );
        updateData.imageUrl = uploadResult.secure_url;
        updateData.imagePublicId = uploadResult.public_id;
      }

      const updatedMemory = await PersonalMemory.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );

      res.json(updatedMemory);
    } catch (error) {
      console.error("Error updating memory:", error);
      res.status(500).json({ error: "Failed to update memory" });
    }
  }
);

// Update the Delete personal memory endpoint
app.delete("/api/personal-memories/:id", async (req, res) => {
  try {
    const memory = await PersonalMemory.findById(req.params.id);

    if (!memory) {
      return res.status(404).json({ error: "Memory not found" });
    }

    // Delete image from Cloudinary if it exists
    if (memory.imagePublicId) {
      await deleteFromCloudinary(memory.imagePublicId);
    }

    await PersonalMemory.findByIdAndDelete(req.params.id);
    res.json({ message: "Memory deleted successfully" });
  } catch (error) {
    console.error("Error deleting memory:", error);
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

// Add this after your other schemas (after PersonalMemory schema)

// Music Entry Schema
const musicEntrySchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
  },
  youtubeUrl: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    default: "",
  },
  artist: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const MusicEntry = mongoose.model("MusicEntry", musicEntrySchema);

// Add these routes after your Personal Memory routes

// Get all music entries
app.get("/api/music", async (req, res) => {
  try {
    const musicEntries = await MusicEntry.find().sort({ date: -1 });
    res.json(musicEntries);
  } catch (error) {
    console.error("Error fetching music entries:", error);
    res.status(500).json({ error: "Failed to fetch music entries" });
  }
});

// Get music entry by date
app.get("/api/music/date/:date", async (req, res) => {
  try {
    const musicEntry = await MusicEntry.findOne({ date: req.params.date });
    
    if (!musicEntry) {
      return res.status(404).json({ error: "No music for this date" });
    }
    
    res.json(musicEntry);
  } catch (error) {
    console.error("Error fetching music entry:", error);
    res.status(500).json({ error: "Failed to fetch music entry" });
  }
});

// Create new music entry
app.post("/api/music", async (req, res) => {
  try {
    const { date, youtubeUrl, title, artist } = req.body;

    if (!youtubeUrl) {
      return res.status(400).json({ error: "YouTube URL is required" });
    }

    // Check if entry exists for this date
    const existingEntry = await MusicEntry.findOne({ date });
    if (existingEntry) {
      return res.status(400).json({ 
        error: "Music entry for this date already exists. Use PUT to update." 
      });
    }

    const musicEntry = new MusicEntry({
      date,
      youtubeUrl,
      title: title || "",
      artist: artist || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await musicEntry.save();
    res.status(201).json(musicEntry);
  } catch (error) {
    console.error("Error creating music entry:", error);
    res.status(500).json({ error: "Failed to create music entry" });
  }
});

// Update music entry
app.put("/api/music/:id", async (req, res) => {
  try {
    const { youtubeUrl, title, artist } = req.body;

    const updateData = {
      updatedAt: new Date(),
    };

    if (youtubeUrl) updateData.youtubeUrl = youtubeUrl;
    if (title !== undefined) updateData.title = title;
    if (artist !== undefined) updateData.artist = artist;

    const musicEntry = await MusicEntry.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!musicEntry) {
      return res.status(404).json({ error: "Music entry not found" });
    }

    res.json(musicEntry);
  } catch (error) {
    console.error("Error updating music entry:", error);
    res.status(500).json({ error: "Failed to update music entry" });
  }
});

// Delete music entry
app.delete("/api/music/:id", async (req, res) => {
  try {
    const musicEntry = await MusicEntry.findByIdAndDelete(req.params.id);

    if (!musicEntry) {
      return res.status(404).json({ error: "Music entry not found" });
    }

    res.json({ message: "Music entry deleted successfully" });
  } catch (error) {
    console.error("Error deleting music entry:", error);
    res.status(500).json({ error: "Failed to delete music entry" });
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
