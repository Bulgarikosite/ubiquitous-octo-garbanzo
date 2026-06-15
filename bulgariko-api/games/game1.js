/**
 * games/game1.js — Sword Fight on the Heights
 *
 * Server-side logic for this game.
 * Each exported function is called by games/index.js at the right time.
 *
 * Frontend canvas loop still runs on the client; these endpoints provide
 * authoritative score tracking and multiplayer state.
 */

/* ── game metadata (shown in the /api/games list) ── */
const meta = {
  id:          "sword_fight",
  name:        "Sword Fight on the Heights",
  description: "Fast-paced duel on a floating platform. Last one standing wins.",
  genre:       "Action",
  maxPlayers:  4,
  minPlayers:  1,
  thumbnail:   "/games/thumbs/sword_fight.png",
  cfg: {
    timeLimit:   40,     // seconds
    arenaWidth:  560,
    arenaHeight: 320,
    playerSpeed: 5,
    playerSize:  34,
  }
};

/**
 * onStart(room) → initialState
 * Called when the host presses Start.
 * Returns an object that becomes room.state.
 */
function onStart(room) {
  const positions = [
    { x: 80,  y: 160 },
    { x: 480, y: 160 },
    { x: 280, y: 60  },
    { x: 280, y: 260 },
  ];

  return {
    timeLeft: meta.cfg.timeLimit,
    tick:     0,
    players:  room.players.map((p, i) => ({
      id:      p.id,
      x:       positions[i % positions.length].x,
      y:       positions[i % positions.length].y,
      hp:      3,       // 3 hits before elimination
      alive:   true,
      score:   0,
    })),
    events: [],  // log of notable events for the client to display
  };
}

/**
 * onAction(room, player, body) → result
 * body can contain:
 *   { type: "move",   dx, dy }         - player moved
 *   { type: "attack", targetId }       - player swung sword
 *   { type: "tick",   timeLeft }       - client heartbeat / timer sync
 */
function onAction(room, player, body) {
  const state   = room.state;
  const self    = state.players.find(p => p.id === player.id);
  if (!self || !self.alive) return { ok: false, reason: "Player not active" };

  const { type } = body;

  if (type === "move") {
    const { dx = 0, dy = 0 } = body;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    self.x = clamp(self.x + dx * meta.cfg.playerSpeed, 0, meta.cfg.arenaWidth);
    self.y = clamp(self.y + dy * meta.cfg.playerSpeed, 0, meta.cfg.arenaHeight);
    return { ok: true };
  }

  if (type === "attack") {
    const { targetId } = body;
    const target = state.players.find(p => p.id === targetId);
    if (!target || !target.alive) return { ok: false, reason: "Invalid target" };

    // simple proximity check (trusts client x/y — replace with server-side if cheating is a concern)
    const dist = Math.hypot(self.x - target.x, self.y - target.y);
    if (dist > 80) return { ok: false, reason: "Out of range" };

    target.hp -= 1;
    if (target.hp <= 0) {
      target.alive = false;
      self.score  += 1;
      // update scoreboard on the room's player list too
      const rp = room.players.find(p => p.id === player.id);
      if (rp) rp.score = self.score;
      state.events.push({ type: "eliminated", by: player.id, victim: targetId });
    }

    return { ok: true, targetHp: target.hp, targetAlive: target.alive };
  }

  if (type === "tick") {
    state.timeLeft = Math.min(state.timeLeft, body.timeLeft ?? state.timeLeft);
    state.tick    += 1;

    // auto-end if time runs out or only 1 alive
    const alive = state.players.filter(p => p.alive);
    if (state.timeLeft <= 0 || alive.length <= 1) {
      room.status  = "ended";
      room.endedAt = Date.now();
      room.summary = buildSummary(room);
      state.events.push({ type: "game_over" });
    }

    return { ok: true, state };
  }

  return { ok: false, reason: "Unknown action type" };
}

/**
 * onEnd(room) → summary
 * Called when the game ends (host calls /end or timer expires).
 */
function onEnd(room) {
  return buildSummary(room);
}

function buildSummary(room) {
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  return {
    winner:    ranked[0]?.username || "Nobody",
    winnerId:  ranked[0]?.id       || null,
    scores:    ranked.map(p => ({ id: p.id, username: p.username, score: p.score })),
    pointsEarned: ranked.map(p => ({
      id:     p.id,
      points: p.score * 5,       // 5 points per kill
    })),
  };
}

module.exports = { meta, onStart, onAction, onEnd };
