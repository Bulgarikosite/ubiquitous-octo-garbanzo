const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

const authRoutes  = require("./auth");
const gamesRoutes = require("./games/index");

const app = express();

/* =========================
   SECURITY / MIDDLEWARE
========================= */
app.use(helmet());
app.use(morgan("dev"));

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

/* =========================
   ROUTES
========================= */
app.use("/api/auth",  authRoutes);
app.use("/api/games", gamesRoutes);   // <-- new

app.get("/", (req, res) => {
  res.json({ success: true, message: "Bulgariko API running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   404 HANDLER (KEEP LAST)
========================= */
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found", path: req.originalUrl });
});

/* =========================
   DB + SERVER START
========================= */
async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log("Server running on port", PORT));
  } catch (err) {
    console.error("Mongo error:", err);
  }
}

startServer();
