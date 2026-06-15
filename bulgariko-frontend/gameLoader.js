/**
 * gameLoader.js
 * Drop this file next to index.html and add:
 *   <script src="gameLoader.js"></script>
 * before the closing </body>.
 *
 * It replaces the old inline gameplay functions and connects every game
 * to the /api/games backend so rooms are real multiplayer.
 *
 * Public API (called from index.html the same way as before):
 *   playGame(name)             — opens the "choose mode" modal
 *   openGameRoom(name, mode)   — creates/joins a room and navigates to gameplay
 *   renderGameplayPage()       — draws the current game room on screen
 *   startGame()                — tells the server to start; begins canvas loop
 *   endCurrentGame()           — tells server to end; shows summary
 *   leaveGame()                — leaves room and returns to games list
 */

/* ─────────────────────────────────────────────────────
   GAME REGISTRY  (must match server meta.id values)
───────────────────────────────────────────────────── */
const GAME_REGISTRY = [
  {
    id:          "sword_fight",
    name:        "Sword Fight on the Heights",
    desc:        "Fast-paced duel on a floating platform.",
    genre:       "Action",
    multiplayer: true,
    palette:     ["#f5cba7","#eb984e"],
    avatarEnabled: true,
    cfg:         { playerSpeed:5, playerSize:34, timeLeft:40 },
  },
  {
    id:          "natural_disaster",
    name:        "Natural Disaster Survival",
    desc:        "Survive falling hazards and stay alive.",
    genre:       "Action",
    multiplayer: true,
    palette:     ["#fad7a0","#f0b27a"],
    cfg:         { playerSpeed:4, playerSize:30, timeLeft:60 },
  },
  {
    id:          "tower_of_hell",
    name:        "Tower of Hell",
    desc:        "Climb the tower while avoiding traps.",
    genre:       "Adventure",
    multiplayer: true,
    palette:     ["#f1948a","#e74c3c"],
    cfg:         { playerSpeed:5, playerSize:26, timeLeft:120 },
  },
];

/* map name → registry entry */
function getGameByName(name) {
  return GAME_REGISTRY.find(g => g.name === name || g.id === name) || null;
}

/* ─────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────── */
let GL = {
  room:         null,   // current room object from the server
  gameEntry:    null,   // registry entry
  canvasLoop:   null,   // setInterval handle
  keyState:     {},
  playerState:  {},     // local authoritative position / score
  pollInterval: null,   // poll server for room state
};

/* ─────────────────────────────────────────────────────
   PLAY GAME MODAL  (same interface as before)
───────────────────────────────────────────────────── */
function playGame(name) {
  const game = getGameByName(name);
  if (!game) { toast("Game not found."); return; }
  openModal(game.name, `
    <div style="font-size:12px;line-height:1.6;color:#333;margin-bottom:12px;">${game.desc}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn" onclick="openGameRoom('${esc(name)}','Single')">Single Player</button>
      <button class="btn ${game.multiplayer ? 'btn-green' : 'btn-gray'}"
        onclick="openGameRoom('${esc(name)}','Multiplayer')"
        ${game.multiplayer ? '' : 'disabled'}>Multiplayer</button>
      <button class="btn btn-gray" onclick="openGameRoom('${esc(name)}','Practice')">Practice</button>
    </div>
    <div style="margin-top:12px;font-size:11px;color:#666;">
      ${game.multiplayer ? 'Multiplayer available — invite friends!' : 'Single player only.'}
    </div>`);
}

/* ─────────────────────────────────────────────────────
   OPEN GAME ROOM  (creates backend room then navigates)
───────────────────────────────────────────────────── */
async function openGameRoom(name, mode) {
  closeModal();
  const game = getGameByName(name);
  if (!game) { toast("Game not found."); return; }

  GL.gameEntry = game;
  GL.keyState  = {};

  try {
    if (mode === "Multiplayer" && !isGuest && getToken()) {
      /* create a real multiplayer room on the server */
      const res = await api("POST", "/api/games/rooms", { gameId: game.id, mode });
      GL.room = res.room;
    } else {
      /* offline / guest / single — fake a local room */
      GL.room = makeFakeRoom(game, mode);
    }
  } catch (err) {
    toast("Could not create room: " + err.message);
    GL.room = makeFakeRoom(game, mode);   // fall back to local
  }

  GL.playerState = {
    x: 270, y: 220,
    score: 0,
    hp: 3,
    alive: true,
  };

  navigate("gameplay");
}

function makeFakeRoom(game, mode) {
  return {
    id:          "local_" + Date.now(),
    gameId:      game.id,
    mode:        mode === "Practice" ? "Single" : mode,
    hostId:      DATA.user.id,
    status:      "lobby",
    playerCount: 1,
    players: [{
      id:       DATA.user.id,
      username: DATA.user.name || "Player",
      score:    0,
    }],
    state: {},
    summary: null,
    local: true,    // flag: don't hit the server
  };
}

/* ─────────────────────────────────────────────────────
   RENDER GAMEPLAY PAGE
───────────────────────────────────────────────────── */
function renderGameplayPage() {
  updateTopbar();
  const el = document.getElementById("gameplay-content");
  if (!GL.room) {
    el.innerHTML = '<div class="empty-state">Choose a game from the Games page.</div>';
    return;
  }
  const game = GL.gameEntry || getGameByName(GL.room.gameId);
  const r    = GL.room;

  const statusLabel = r.status === "playing" ? "In progress" : r.status === "ended" ? "Ended" : "Lobby";
  const header = `<div class="card-box">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div>
        <div style="font-size:16px;font-weight:bold;">${esc(game ? game.name : r.gameId)}</div>
        <div style="font-size:12px;color:#666;">Mode: ${esc(r.mode)} · ${statusLabel}
          ${r.local ? ' · <span style="color:#e67e22;">Local (offline)</span>' : ''}</div>
      </div>
      <div class="game-toolbar">
        ${r.status === "playing"
          ? `<button class="btn btn-red" onclick="endCurrentGame()">Stop</button>`
          : r.status === "lobby"
          ? `<button class="btn" onclick="startGame()">Start</button>`
          : ""}
        <button class="btn btn-gray" onclick="leaveGame()">Exit</button>
      </div>
    </div>
    <div style="font-size:12px;color:#555;margin-top:6px;">${esc(game ? game.desc : "")}</div>
  </div>`;

  const gameArea = r.status === "playing"
    ? `<canvas id="game-canvas" class="game-room-canvas" width="560" height="320"></canvas>`
    : r.status === "ended"
    ? renderSummaryHtml(r.summary)
    : `<div class="card-box">${r.mode === "Multiplayer" ? renderLobbyHtml() : '<div class="empty-state">Press Start to begin.</div>'}</div>`;

  const scoreHtml = r.players.map(p =>
    `<div class="score-card">
      <div style="font-weight:bold;">${esc(p.username)}</div>
      <div style="font-size:11px;color:#666;">${p.id === DATA.user.id ? "You" : "Player"}</div>
      <div style="margin-top:6px;font-size:18px;color:#0099da;">${p.score} pts</div>
    </div>`).join("");

  el.innerHTML = header + gameArea + `<div class="game-scoreboard">${scoreHtml}</div>`;

  if (r.status === "playing") initGameCanvas(game);
}

/* ─────────────────────────────────────────────────────
   LOBBY HTML
───────────────────────────────────────────────────── */
function renderLobbyHtml() {
  const r       = GL.room;
  const players = r.players.map(p =>
    `<div class="lobby-card">${esc(p.username)} ${p.id === DATA.user.id ? "(You)" : ""}</div>`
  ).join("");

  const onlineFriends = (DATA.friends || []).filter(f => f.online);
  const inviteBtns = onlineFriends.length
    ? onlineFriends.map(f =>
        `<button class="btn btn-gray" onclick="inviteFriendToRoom('${esc(f.id || f._id)}')">${esc(f.name || f.username)}</button>`
      ).join("")
    : '<div class="small">No online friends.</div>';

  /* copy-to-clipboard room code */
  const roomCode = r.local ? "Local only" : r.id;

  return `<div class="section-title">Lobby</div>
    <div>${players}</div>
    <div style="font-size:11px;color:#888;margin:8px 0;">
      Room code: <b>${esc(roomCode)}</b>
      ${r.local ? "" : `<button class="btn btn-gray" style="margin-left:6px;font-size:10px;padding:2px 6px;" onclick="copyRoomCode('${esc(r.id)}')">Copy</button>`}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${inviteBtns}</div>`;
}

function copyRoomCode(id) {
  navigator.clipboard.writeText(id).then(() => toast("Room code copied!")).catch(() => toast("Copy failed"));
}

async function inviteFriendToRoom(friendId) {
  if (!GL.room || GL.room.local) { toast("Local room — invite not available."); return; }
  try {
    const res = await api("POST", `/api/games/rooms/${GL.room.id}/invite`, { friendId });
    toast("Invite sent!");
  } catch (err) {
    toast(err.message || "Could not invite.");
  }
}

/* ─────────────────────────────────────────────────────
   SUMMARY HTML
───────────────────────────────────────────────────── */
function renderSummaryHtml(summary) {
  if (!summary) return '<div class="card-box"><div class="empty-state">Game over.</div></div>';
  const rows = (summary.scores || []).map((s, i) =>
    `<div style="background:#fff;border:1px solid #ccc;padding:8px 12px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:bold;color:${i === 0 ? "#f1c40f" : "#333"};">${i+1}. ${esc(s.username)}</span>
      <span style="font-size:14px;color:#0099da;">${s.score} pts</span>
    </div>`
  ).join("");
  const youEarned = (summary.pointsEarned || []).find(p => p.id === DATA.user.id);
  return `<div class="card-box">
    <div style="font-size:14px;font-weight:bold;margin-bottom:10px;">
      🏆 Winner: ${esc(summary.winner)}
    </div>
    ${rows}
    ${youEarned ? `<div style="margin-top:10px;font-size:12px;color:#27ae60;font-weight:bold;">+${youEarned.points} Points earned!</div>` : ""}
    <button class="btn mt8" onclick="navigate('games')">Back to Games</button>
  </div>`;
}

/* ─────────────────────────────────────────────────────
   START GAME
───────────────────────────────────────────────────── */
async function startGame() {
  if (!GL.room) return;

  if (!GL.room.local) {
    try {
      const res = await api("POST", `/api/games/rooms/${GL.room.id}/start`, {});
      GL.room = res.room;
    } catch (err) {
      toast(err.message || "Could not start.");
      return;
    }
  } else {
    GL.room.status = "playing";
    GL.room.state  = { timeLeft: GL.gameEntry.cfg.timeLeft, tick: 0, events: [] };
  }

  GL.playerState = { x: 270, y: 220, score: 0, hp: 3, alive: true, floor: 0 };
  renderGameplayPage();

  /* start server polling for multiplayer rooms */
  if (!GL.room.local) {
    GL.pollInterval = setInterval(pollRoomState, 1000);
  }

  if (GL.canvasLoop) clearInterval(GL.canvasLoop);
  GL.canvasLoop = setInterval(gameFrame, 1000 / 30);
  document.addEventListener("keydown", onGameKey);
  document.addEventListener("keyup",   onGameKeyUp);
}

async function pollRoomState() {
  if (!GL.room || GL.room.local || GL.room.status === "ended") {
    clearInterval(GL.pollInterval);
    return;
  }
  try {
    const res  = await api("GET", `/api/games/rooms/${GL.room.id}`);
    GL.room    = res.room;
    /* update scoreboard without full re-render */
    res.room.players.forEach(p => {
      const el = document.querySelector(`[data-player-score="${p.id}"]`);
      if (el) el.textContent = p.score + " pts";
    });
    if (GL.room.status === "ended") endCurrentGame();
  } catch {}
}

/* ─────────────────────────────────────────────────────
   CANVAS GAME LOOP
───────────────────────────────────────────────────── */
function initGameCanvas(game) {
  /* set up key bindings again in case page re-rendered */
  document.removeEventListener("keydown", onGameKey);
  document.removeEventListener("keyup",   onGameKeyUp);
  document.addEventListener("keydown",    onGameKey);
  document.addEventListener("keyup",      onGameKeyUp);
}

function onGameKey(e) {
  const keys = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d"];
  if (keys.includes(e.key)) { GL.keyState[e.key] = true; e.preventDefault(); }
}

function onGameKeyUp(e) {
  GL.keyState[e.key] = false;
}

let _tickCount = 0;
async function gameFrame() {
  if (!GL.room || GL.room.status !== "playing") return;

  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  /* ── move player ── */
  const speed = GL.gameEntry?.cfg?.playerSpeed || 4;
  const size  = GL.gameEntry?.cfg?.playerSize  || 30;
  let dx = 0, dy = 0;
  if (GL.keyState["ArrowLeft"]  || GL.keyState["a"]) dx -= 1;
  if (GL.keyState["ArrowRight"] || GL.keyState["d"]) dx += 1;
  if (GL.keyState["ArrowUp"]    || GL.keyState["w"]) dy -= 1;
  if (GL.keyState["ArrowDown"]  || GL.keyState["s"]) dy += 1;

  GL.playerState.x = Math.max(0, Math.min(W - size, GL.playerState.x + dx * speed));
  GL.playerState.y = Math.max(0, Math.min(H - size, GL.playerState.y + dy * speed));

  /* ── send move to server every 6 frames ── */
  _tickCount++;
  if (!GL.room.local && _tickCount % 6 === 0 && dx !== 0 || dy !== 0) {
    api("POST", `/api/games/rooms/${GL.room.id}/action`, {
      type: "move", dx, dy
    }).catch(() => {});
  }

  /* ── send tick to server every 30 frames (≈ 1 s) ── */
  const state = GL.room.state || {};
  if (!GL.room.local && _tickCount % 30 === 0) {
    api("POST", `/api/games/rooms/${GL.room.id}/action`, {
      type: "tick", timeLeft: (state.timeLeft || 0) - 1
    }).catch(() => {});
  }

  /* ── decrement local timer ── */
  if (_tickCount % 30 === 0) {
    if (!state.timeLeft) state.timeLeft = GL.gameEntry?.cfg?.timeLeft || 30;
    state.timeLeft = Math.max(0, (state.timeLeft || 0) - 1);
    if (state.timeLeft <= 0) { endCurrentGame(); return; }
  }

  /* ──────────────────────────────
     DRAW — cleared every frame
  ────────────────────────────── */
  const gameId = GL.gameEntry?.id || GL.room.gameId;

  /* background */
  ctx.fillStyle = gameId === "natural_disaster" ? "#87ceeb"
                : gameId === "tower_of_hell"    ? "#1a1a2e"
                : "#2d6a4f";
  ctx.fillRect(0, 0, W, H);

  /* game-specific background elements */
  if (gameId === "sword_fight") drawSwordFightBg(ctx, W, H);
  if (gameId === "natural_disaster") drawDisasterBg(ctx, W, H, state);
  if (gameId === "tower_of_hell") drawTowerBg(ctx, W, H, state);

  /* ── other players (from server state) ── */
  if (state.players) {
    state.players.forEach(sp => {
      if (sp.id === DATA.user.id) return;  // draw self separately
      ctx.fillStyle = "#e74c3c";
      ctx.fillRect(sp.x - size / 2, sp.y - size / 2, size, size);
      ctx.fillStyle = "#fff";
      ctx.font = "9px Arial";
      ctx.textAlign = "center";
      ctx.fillText(sp.username || "Player", sp.x, sp.y - size / 2 - 4);
    });
  }

  /* ── local player (avatar) ── */
  const p = GL.playerState;
  if (p.alive) {
    if (typeof drawAvatarCanvas === "function") {
      drawAvatarCanvas(ctx, p.x - size / 2, p.y - size, size, size * 2, getUserAvatarSettings());
    } else {
      ctx.fillStyle = "#0099da";
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    /* HP bar */
    ctx.fillStyle = "#555";
    ctx.fillRect(p.x - 20, p.y - size / 2 - 12, 40, 5);
    ctx.fillStyle = "#27ae60";
    ctx.fillRect(p.x - 20, p.y - size / 2 - 12, 40 * (p.hp / 3), 5);
  }

  /* ── HUD ── */
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, W, 24);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Score: " + p.score, 10, 16);
  ctx.textAlign = "center";
  ctx.fillText(GL.gameEntry?.name || gameId, W / 2, 16);
  ctx.textAlign = "right";
  ctx.fillStyle = (state.timeLeft || 0) < 10 ? "#e74c3c" : "#fff";
  ctx.fillText("Time: " + Math.ceil(state.timeLeft || 0) + "s", W - 10, 16);
}

/* ─── background renderers ─── */
function drawSwordFightBg(ctx, W, H) {
  /* floating platform */
  ctx.fillStyle = "#8B4513";
  ctx.fillRect(40, H - 60, W - 80, 20);
  ctx.fillStyle = "#556B2F";
  ctx.fillRect(40, H - 80, W - 80, 22);
  /* edge danger zones */
  ctx.fillStyle = "rgba(231,76,60,0.3)";
  ctx.fillRect(0, 0, 40, H);
  ctx.fillRect(W - 40, 0, 40, H);
}

function drawDisasterBg(ctx, W, H, state) {
  /* ground */
  ctx.fillStyle = "#7daa72";
  ctx.fillRect(0, H - 40, W, 40);
  /* hazards */
  ctx.fillStyle = "#e74c3c";
  (state.hazards || []).forEach(h => {
    ctx.fillRect(h.x, h.y, h.w, h.h);
  });
}

function drawTowerBg(ctx, W, H, state) {
  /* platforms per floor */
  const floors = 10;
  ctx.fillStyle = "#5c5470";
  for (let f = 1; f <= floors; f++) {
    const y = H - f * 30;
    ctx.fillRect(20, y, W - 40, 8);
  }
  /* obstacles */
  ctx.fillStyle = "#e74c3c";
  (state.obstacles || []).forEach(ob => {
    ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
  });
}

/* ─────────────────────────────────────────────────────
   END GAME
───────────────────────────────────────────────────── */
async function endCurrentGame() {
  if (GL.canvasLoop)   { clearInterval(GL.canvasLoop);   GL.canvasLoop   = null; }
  if (GL.pollInterval) { clearInterval(GL.pollInterval); GL.pollInterval = null; }
  document.removeEventListener("keydown", onGameKey);
  document.removeEventListener("keyup",   onGameKeyUp);
  _tickCount = 0;

  if (GL.room && !GL.room.local && GL.room.status === "playing") {
    try {
      const res    = await api("POST", `/api/games/rooms/${GL.room.id}/end`, {});
      GL.room      = res.room;

      /* award points on the user account */
      const earned = (res.summary?.pointsEarned || []).find(p => p.id === DATA.user.id);
      if (earned?.points > 0) {
        try {
          await api("POST", "/api/auth/exchange-points", { points: 0 }); // just as a noop ping
          /* Actually add the points: update DATA and save */
          setPoints(getPoints() + earned.points);
          await api("PATCH", "/api/auth/data", { user: { points: getPoints() } });
          updateTopbar();
          addActivity("Earned " + earned.points + " points from " + GL.gameEntry?.name);
          toast("+" + earned.points + " Points!");
        } catch {}
      }
    } catch {}
  } else if (GL.room) {
    GL.room.status  = "ended";
    GL.room.summary = {
      winner:      DATA.user.name,
      winnerId:    DATA.user.id,
      scores:      [{ id: DATA.user.id, username: DATA.user.name, score: GL.playerState.score }],
      pointsEarned:[{ id: DATA.user.id, points: Math.floor(GL.playerState.score * 2) }],
    };
    const pts = Math.floor(GL.playerState.score * 2);
    if (pts > 0) {
      setPoints(getPoints() + pts);
      updateTopbar();
      addActivity("Earned " + pts + " points from " + GL.gameEntry?.name);
      toast("+" + pts + " Points!");
    }
  }

  renderGameplayPage();
}

/* ─────────────────────────────────────────────────────
   LEAVE GAME
───────────────────────────────────────────────────── */
async function leaveGame() {
  if (GL.canvasLoop)   { clearInterval(GL.canvasLoop);   GL.canvasLoop   = null; }
  if (GL.pollInterval) { clearInterval(GL.pollInterval); GL.pollInterval = null; }
  document.removeEventListener("keydown", onGameKey);
  document.removeEventListener("keyup",   onGameKeyUp);

  if (GL.room && !GL.room.local) {
    try { await api("POST", `/api/games/rooms/${GL.room.id}/leave`, {}); } catch {}
  }

  GL.room      = null;
  GL.gameEntry = null;
  navigate("games");
}

/* ─────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────── */
function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/* expose GAME_REGISTRY for the games page renderer in index.html */
window.GAME_REGISTRY = GAME_REGISTRY;
