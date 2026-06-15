/**
 * games/game2.js — Natural Disaster Survival
 *
 * Players move around the arena and try to stay alive while
 * hazards rain down. Last player standing (or highest score) wins.
 */

const DISASTERS = ["Meteor Shower", "Flood", "Earthquake", "Tornado", "Blizzard"];

const meta = {
  id:          "natural_disaster",
  name:        "Natural Disaster Survival",
  description: "Survive falling hazards and stay alive as long as possible.",
  genre:       "Action",
  maxPlayers:  6,
  minPlayers:  1,
  thumbnail:   "/games/thumbs/natural_disaster.png",
  cfg: {
    timeLimit:    60,
    arenaWidth:   560,
    arenaHeight:  320,
    playerSpeed:  4,
    playerSize:   30,
    hazardCount:  12,
  }
};

function onStart(room) {
  const disaster = DISASTERS[Math.floor(Math.random() * DISASTERS.length)];

  return {
    timeLeft:  meta.cfg.timeLimit,
    tick:      0,
    disaster,
    hazards:   makeHazards(meta.cfg.hazardCount),
    players:   room.players.map((p, i) => ({
      id:      p.id,
      x:       80 + (i * 100),
      y:       200,
      hp:      5,
      alive:   true,
      score:   0,
      survivalSeconds: 0,
    })),
    events: [],
  };
}

function onAction(room, player, body) {
  const state = room.state;
  const self  = state.players.find(p => p.id === player.id);
  if (!self || !self.alive) return { ok: false, reason: "Player not active" };

  const { type } = body;

  if (type === "move") {
    const { dx = 0, dy = 0 } = body;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    self.x = clamp(self.x + dx * meta.cfg.playerSpeed, 0, meta.cfg.arenaWidth);
    self.y = clamp(self.y + dy * meta.cfg.playerSpeed, 0, meta.cfg.arenaHeight);
    return { ok: true };
  }

  if (type === "hit") {
    // client reports a hazard hit them
    self.hp -= body.damage || 1;
    if (self.hp <= 0) {
      self.alive = false;
      state.events.push({ type: "eliminated", victim: player.id, cause: state.disaster });
    }
    return { ok: true, hp: self.hp, alive: self.alive };
  }

  if (type === "tick") {
    state.timeLeft = Math.min(state.timeLeft, body.timeLeft ?? state.timeLeft);
    state.tick    += 1;

    // award survival points each tick (30 ticks/s → 1 pt/s)
    state.players.filter(p => p.alive).forEach(p => {
      if (state.tick % 30 === 0) {
        p.score += 1;
        p.survivalSeconds += 1;
        const rp = room.players.find(rp => rp.id === p.id);
        if (rp) rp.score = p.score;
      }
    });

    // respawn hazards as they fall off screen
    state.hazards = state.hazards.map(h => {
      if (h.y > meta.cfg.arenaHeight + 40) {
        return { x: 10 + Math.random() * 520, y: -20, w: 18, h: 18, speed: 1 + Math.random() * 3 };
      }
      return { ...h, y: h.y + h.speed };
    });

    const alive = state.players.filter(p => p.alive);
    if (state.timeLeft <= 0 || alive.length === 0) {
      room.status  = "ended";
      room.endedAt = Date.now();
      room.summary = buildSummary(room);
      state.events.push({ type: "game_over" });
    }

    return { ok: true, state };
  }

  return { ok: false, reason: "Unknown action type" };
}

function onEnd(room) {
  return buildSummary(room);
}

function buildSummary(room) {
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  return {
    winner:   ranked[0]?.username || "Nobody",
    winnerId: ranked[0]?.id       || null,
    scores:   ranked.map(p => ({ id: p.id, username: p.username, score: p.score })),
    pointsEarned: ranked.map(p => ({
      id:     p.id,
      points: p.score * 3,   // 3 points per survival second
    })),
  };
}

function makeHazards(n) {
  return Array.from({ length: n }, () => ({
    x:     10 + Math.random() * 520,
    y:    -20 - Math.random() * 240,
    w:     16 + Math.random() * 8,
    h:     16 + Math.random() * 8,
    speed: 1  + Math.random() * 3,
  }));
}

module.exports = { meta, onStart, onAction, onEnd };
