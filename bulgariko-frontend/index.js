/**
 * games/index.js
 * Mounts every individual game file and exposes shared game endpoints.
 *
 * Routes exposed under /api/games:
 *   GET  /                  - list all available games
 *   GET  /rooms             - list all open rooms (across all games)
 *   POST /rooms             - create a room (body: { gameId, mode })
 *   GET  /rooms/:roomId     - get one room's state
 *   POST /rooms/:roomId/join  - join a room
 *   POST /rooms/:roomId/leave - leave a room
 *   POST /rooms/:roomId/start - start the game (host only)
 *   POST /rooms/:roomId/action- send a game action
 *   POST /rooms/:roomId/end   - end/resolve the game
 *
 * Each game file in this folder exports:
 *   { meta, onStart, onAction, onEnd }
 */

const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");

/* ── load individual game modules ── */
const game1 = require("./game1");   // Sword Fight on the Heights
const game2 = require("./game2");   // Natural Disaster Survival
const game3 = require("./game3");   // Tower of Hell

const GAMES = {
  [game1.meta.id]: game1,
  [game2.meta.id]: game2,
  [game3.meta.id]: game3,
};

/* ── in-memory room store (replace with MongoDB if you need persistence) ── */
const rooms = {};   // roomId -> roomObject
let roomCounter = 0;

function makeRoomId() {
  return "room_" + (++roomCounter) + "_" + Date.now();
}

/* ── optional auth middleware ── */
function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/* ══════════════════════════════
   LIST ALL GAMES
══════════════════════════════ */
router.get("/", (req, res) => {
  const list = Object.values(GAMES).map(g => g.meta);
  res.json({ games: list });
});

/* ══════════════════════════════
   LIST OPEN ROOMS
══════════════════════════════ */
router.get("/rooms", (req, res) => {
  const { gameId } = req.query;
  let list = Object.values(rooms).filter(r => r.status === "lobby");
  if (gameId) list = list.filter(r => r.gameId === gameId);
  res.json({ rooms: list.map(publicRoom) });
});

/* ══════════════════════════════
   CREATE A ROOM
══════════════════════════════ */
router.post("/rooms", auth, (req, res) => {
  const { gameId, mode = "Multiplayer" } = req.body;
  if (!GAMES[gameId]) return res.status(404).json({ message: "Game not found" });

  const roomId = makeRoomId();
  const room = {
    id: roomId,
    gameId,
    mode,
    hostId: req.user.id,
    players: [{
      id: req.user.id,
      username: req.user.username || "Player",
      score: 0,
      ready: false
    }],
    status: "lobby",       // lobby | playing | ended
    state: {},             // game-specific state set by onStart
    createdAt: Date.now(),
  };

  rooms[roomId] = room;
  res.json({ success: true, room: publicRoom(room) });
});

/* ══════════════════════════════
   GET ONE ROOM
══════════════════════════════ */
router.get("/rooms/:roomId", (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ message: "Room not found" });
  res.json({ room: publicRoom(room) });
});

/* ══════════════════════════════
   JOIN A ROOM
══════════════════════════════ */
router.post("/rooms/:roomId/join", auth, (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.status !== "lobby") return res.status(400).json({ message: "Game already started" });

  const game = GAMES[room.gameId];
  const maxPlayers = game.meta.maxPlayers || 4;
  if (room.players.length >= maxPlayers) return res.status(400).json({ message: "Room full" });

  const already = room.players.some(p => p.id === req.user.id);
  if (!already) {
    room.players.push({
      id: req.user.id,
      username: req.user.username || "Player",
      score: 0,
      ready: false
    });
  }

  res.json({ success: true, room: publicRoom(room) });
});

/* ══════════════════════════════
   LEAVE A ROOM
══════════════════════════════ */
router.post("/rooms/:roomId/leave", auth, (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ message: "Room not found" });

  room.players = room.players.filter(p => p.id !== req.user.id);

  // if host left, reassign or delete
  if (room.hostId === req.user.id) {
    if (room.players.length) {
      room.hostId = room.players[0].id;
    } else {
      delete rooms[req.params.roomId];
      return res.json({ success: true, deleted: true });
    }
  }

  res.json({ success: true, room: publicRoom(room) });
});

/* ══════════════════════════════
   START GAME (host only)
══════════════════════════════ */
router.post("/rooms/:roomId/start", auth, (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.hostId !== req.user.id) return res.status(403).json({ message: "Only the host can start" });
  if (room.status !== "lobby") return res.status(400).json({ message: "Already started" });

  const game = GAMES[room.gameId];
  try {
    room.state  = game.onStart(room);
    room.status = "playing";
    room.startedAt = Date.now();
  } catch (err) {
    return res.status(500).json({ message: "Game start error: " + err.message });
  }

  res.json({ success: true, room: publicRoom(room) });
});

/* ══════════════════════════════
   SEND A GAME ACTION
══════════════════════════════ */
router.post("/rooms/:roomId/action", auth, (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.status !== "playing") return res.status(400).json({ message: "Game not in progress" });

  const player = room.players.find(p => p.id === req.user.id);
  if (!player) return res.status(403).json({ message: "You are not in this room" });

  const game = GAMES[room.gameId];
  try {
    const result = game.onAction(room, player, req.body);
    res.json({ success: true, result, room: publicRoom(room) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ══════════════════════════════
   END GAME (host or server-side)
══════════════════════════════ */
router.post("/rooms/:roomId/end", auth, (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.hostId !== req.user.id) return res.status(403).json({ message: "Only the host can end the game" });
  if (room.status !== "playing") return res.status(400).json({ message: "Game not in progress" });

  const game = GAMES[room.gameId];
  let summary = {};
  try {
    summary = game.onEnd(room);
  } catch {}

  room.status = "ended";
  room.endedAt = Date.now();
  room.summary = summary;

  // clean up room after 60 seconds
  setTimeout(() => { delete rooms[room.id]; }, 60 * 1000);

  res.json({ success: true, summary, room: publicRoom(room) });
});

/* ── helpers ── */
function publicRoom(room) {
  return {
    id:         room.id,
    gameId:     room.gameId,
    mode:       room.mode,
    hostId:     room.hostId,
    status:     room.status,
    playerCount: room.players.length,
    players:    room.players.map(p => ({ id: p.id, username: p.username, score: p.score })),
    state:      room.state,
    summary:    room.summary || null,
    createdAt:  room.createdAt,
  };
}

module.exports = router;
