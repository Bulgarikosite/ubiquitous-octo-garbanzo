/**
 * games/game3.js — Tower of Hell
 *
 * Players race to reach the top of the tower.
 * First to reach floor 10 wins; hazards knock you back down.
 * Playable solo or with friends (race mode in multiplayer).
 */

const meta = {
  id:          "tower_of_hell",
  name:        "Tower of Hell",
  description: "Climb the tower while avoiding traps. First to the top wins!",
  genre:       "Adventure",
  maxPlayers:  4,
  minPlayers:  1,
  thumbnail:   "/games/thumbs/tower_of_hell.png",
  cfg: {
    timeLimit:    120,
    floors:       10,
    arenaWidth:   560,
    arenaHeight:  320,
    playerSpeed:  5,
    playerSize:   26,
  }
};

function onStart(room) {
  return {
    timeLeft: meta.cfg.timeLimit,
    tick:     0,
    players:  room.players.map((p, i) => ({
      id:         p.id,
      x:          60 + i * 80,
      y:          meta.cfg.arenaHeight - 40,
      floor:      0,    // 0 = ground, 10 = top
      hp:         3,
      alive:      true,
      finished:   false,
      score:      0,
    })),
    obstacles: makeObstacles(meta.cfg.floors),
    events:    [],
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

  if (type === "reach_floor") {
    // client reports reaching a new floor checkpoint
    const newFloor = Math.min(Math.max(body.floor || 0, self.floor), meta.cfg.floors);
    if (newFloor > self.floor) {
      const gained = newFloor - self.floor;
      self.floor  = newFloor;
      self.score += gained * 10;   // 10 pts per floor
      const rp = room.players.find(rp => rp.id === player.id);
      if (rp) rp.score = self.score;
      state.events.push({ type: "floor_reached", player: player.id, floor: newFloor });

      if (newFloor >= meta.cfg.floors) {
        self.finished = true;
        state.events.push({ type: "finished", player: player.id });
        // end game when first player finishes in multiplayer, or solo
        room.status  = "ended";
        room.endedAt = Date.now();
        room.summary = buildSummary(room);
        state.events.push({ type: "game_over" });
      }
    }
    return { ok: true, floor: self.floor, score: self.score };
  }

  if (type === "hit") {
    // obstacle hit: knock player back one floor
    self.hp    -= 1;
    self.floor  = Math.max(0, self.floor - 1);
    self.score  = Math.max(0, self.score - 5);
    const rp = room.players.find(rp => rp.id === player.id);
    if (rp) rp.score = self.score;

    if (self.hp <= 0) {
      self.alive = false;
      state.events.push({ type: "eliminated", victim: player.id });
    }

    return { ok: true, hp: self.hp, floor: self.floor };
  }

  if (type === "tick") {
    state.timeLeft = Math.min(state.timeLeft, body.timeLeft ?? state.timeLeft);
    state.tick    += 1;

    const alive    = state.players.filter(p => p.alive && !p.finished);
    const finished = state.players.filter(p => p.finished);

    if (state.timeLeft <= 0 || (finished.length > 0 && alive.length === 0)) {
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
      points: p.score * 2,  // 2 points per score point
    })),
  };
}

function makeObstacles(floors) {
  const obs = [];
  for (let f = 1; f <= floors; f++) {
    const count = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      obs.push({
        floor: f,
        x:     20 + Math.random() * 480,
        y:     (floors - f) * 32 + 10,
        w:     30 + Math.random() * 40,
        h:     12,
        speed: 1 + Math.random() * 2,
        dir:   Math.random() > 0.5 ? 1 : -1,
      });
    }
  }
  return obs;
}

module.exports = { meta, onStart, onAction, onEnd };
