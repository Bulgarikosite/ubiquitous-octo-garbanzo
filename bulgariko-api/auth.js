const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();

const POINTS_PER_BCOIN = 10; // 10 points -> 1 bcoin
const DEFAULT_DATA = {
  groups: [],
  forums: { categories: [] },
  blog: [],
  messages: [],
  inventory: [],
  trades: [],
  activity: [],
  friends: [],
  friendRequests: [],
  blockedUsers: [],
  sentFriendRequests: [],
  lastPointClaim: null,
  user: {
    bodyColorHead: "#f5cba7",
    bodyColorLimbs: "#85c1e9",
    equippedAcc: [],
    equippedClothing: []
  }
};

function makeDefaultData() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

/* =========================
   MODELS
========================= */

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },

  password: {
    type: String,
    required: true
  },

  bio: {
    type: String,
    default: ""
  },

  // POINTS ONLY
  points: {
    type: Number,
    default: 0
  },

  bcoins: {
    type: Number,
    default: 0
  },

  // PLAYER INVENTORY
  inventory: [{
    id: String,
    name: String,
    type: String,
    icon: String,
    rarity: {
      type: String,
      default: "Common"
    },

    limited: {
      type: Boolean,
      default: false
    },

    tradable: {
      type: Boolean,
      default: false
    },

    serial: {
      type: String,
      default: null
    },

    equipped: {
      type: Boolean,
      default: false
    },

    purchasedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // FRIENDS
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  friendRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  // TRADES
  trades: [{
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    itemId: String,

    status: {
      type: String,
      default: "pending"
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // AVATAR
  bodyColorHead: {
    type: String,
    default: "#f5cba7"
  },

  bodyColorLimbs: {
    type: String,
    default: "#85c1e9"
  },

  equippedAcc: {
    type: Array,
    default: []
  },

  equippedClothing: {
    type: Array,
    default: []
  },

  // DAILY REWARD
  lastPointClaim: {
    type: Date,
    default: null
  },

  // LEGACY DATA
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: makeDefaultData
  }

}, {
  timestamps: true
});

const AccessorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: String,
  img: String,
  price: { type: Number, default: 0 }
});

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Accessory = mongoose.models.Accessory || mongoose.model("Accessory", AccessorySchema);

function cleanUsername(username) {
  return String(username || "").trim().replace(/\s+/g, "_").slice(0, 24);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function exactUsernameQuery(username) {
  return new RegExp("^" + String(username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
}

async function findUserByIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  return User.findOne({
    $or: [
      { email: lower },
      { username: exactUsernameQuery(value) }
    ]
  });
}

function getSavedUserData(user) {
  const data = (user && user.data) || {};
  return data.user || {};
}

function publicUser(user) {
  if (!user) return null;
  const obj = typeof user.toObject === "function" ? user.toObject() : user;
  const saved = getSavedUserData(obj);
  return {
    id: String(obj._id || obj.id),
    _id: String(obj._id || obj.id),
    username: obj.username,
    name: obj.username,
    bio: obj.bio || saved.bio || "",
    createdAt: obj.createdAt,
    friendsCount: Array.isArray(obj.friends) ? obj.friends.length : 0,
    avatar: {
      head: saved.bodyColorHead || "#f5cba7",
      limbs: saved.bodyColorLimbs || "#85c1e9",
      acc: saved.equippedAcc || [],
      clothing: saved.equippedClothing || []
    }
  };
}

function mapUserRef(ref) {
  if (!ref) return null;
  if (typeof ref === "string" || ref instanceof mongoose.Types.ObjectId) {
    return { id: String(ref), _id: String(ref), username: "Player", name: "Player", avatar: { head: "#f5cba7", limbs: "#85c1e9", acc: [], clothing: [] } };
  }
  return publicUser(ref);
}

function mergeUniquePlayers(primary, legacy) {
  const seen = new Set();
  return [...(primary || []), ...(legacy || [])].filter(Boolean).map(p => {
    const id = String(p.id || p._id || p.username || p.name);
    if (seen.has(id)) return null;
    seen.add(id);
    return p;
  }).filter(Boolean);
}

function buildUserPayload(user) {
  const obj = typeof user.toObject === "function" ? user.toObject() : user;
  const data = { ...makeDefaultData(), ...(obj.data || {}) };
  const saved = data.user || {};
  const dataPayload = { ...data };
  delete dataPayload.user;
  const schemaFriends = (obj.friends || []).map(mapUserRef);
  const schemaRequests = (obj.friendRequests || []).map(mapUserRef);
  const schemaBlocked = (obj.blockedUsers || []).map(mapUserRef);

  return {
    id: String(obj._id),
    _id: String(obj._id),
    username: obj.username,
    name: obj.username,
    email: obj.email,
    bio: obj.bio || saved.bio || "",
    createdAt: obj.createdAt,
    bcoins: obj.bcoins || 0,
    points: obj.points || obj.tickets || 0,
    ...dataPayload,
    inventory: obj.inventory || data.inventory || [],
    bodyColorHead: saved.bodyColorHead || data.bodyColorHead || "#f5cba7",
    bodyColorLimbs: saved.bodyColorLimbs || data.bodyColorLimbs || "#85c1e9",
    equippedAcc: saved.equippedAcc || data.equippedAcc || [],
    equippedClothing: saved.equippedClothing || data.equippedClothing || [],

    friends: mergeUniquePlayers(schemaFriends, data.friends || []),
    friendRequests: mergeUniquePlayers(schemaRequests, data.friendRequests || []),
    blockedUsers: mergeUniquePlayers(schemaBlocked, data.blockedUsers || [])
  };
}

async function loadFullUser(id) {
  return User.findById(id)
    .select("-password")
    .populate("friends", "username bio data friends createdAt")
    .populate("friendRequests", "username bio data friends createdAt")
    .populate("blockedUsers", "username bio data friends createdAt");
}

function isBlockedBetween(a, b) {
  const aBlocked = (a.blockedUsers || []).some(id => id?.toString() === b._id.toString());
  const bBlocked = (b.blockedUsers || []).some(id => id?.toString() === a._id.toString());
  return aBlocked || bBlocked;
}

function removeId(list, id) {
  return (list || []).filter(item => item?.toString() !== id.toString());
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/* =========================
   REGISTER
========================= */

router.post("/guest", async (req, res) => {
  try {
    const guestId = Math.random().toString(36).slice(2, 10);

    const user = await User.create({
      username: `Guest_${guestId}`,
      email: `guest_${guestId}@guest.local`,
      password: await bcrypt.hash(guestId, 1),
      data: makeDefaultData()
    });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      guest: true,
      token,
      user: buildUserPayload(user)
    });
  } catch (err) {
    res.status(500).json({ message: "Guest creation failed" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const email = String(req.body.email || "").trim().toLowerCase();
    const { password } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ message: "Missing fields" });

    if (username.length < 3)
      return res.status(400).json({ message: "Username must be at least 3 characters" });

    if (!isEmail(email))
      return res.status(400).json({ message: "Enter a valid email" });

    if (password.length < 6)
      return res.status(400).json({ message: "Password too weak" });

    const exists = await User.findOne({
      $or: [
        { email },
        { username: exactUsernameQuery(username) }
      ]
    });
    if (exists)
      return res.status(400).json({ message: "Username or email already exists" });

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({ username, email, password: hash, data: makeDefaultData() });
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ success: true, message: "User created", token, user: buildUserPayload(user) });

  } catch (err) {
    console.log("REGISTER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   LOGIN
========================= */

router.post("/login", async (req, res) => {
  try {
    const identifier = req.body.identifier || req.body.email || req.body.username;
    const { password } = req.body;

    const user = await findUserByIdentifier(identifier);

    if (!user)
      return res.status(400).json({ message: "Wrong credentials" });

    const match = await bcrypt.compare(password, user.password);

    if (!match)
      return res.status(400).json({ message: "Wrong credentials" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("LOGIN OK:", user.username);

    const fullUser = await loadFullUser(user._id);

    console.log("FULL USER LOADED");

    const payload = buildUserPayload(fullUser);

    console.log("PAYLOAD BUILT");

    return res.json({ token, user: payload });

  } catch (err) {
    console.error("LOGIN ERROR FULL:", err);
    return res.status(500).json({ message: err.message });
  }
});

/* =========================
   PROFILE
========================= */

router.get("/me", auth, async (req, res) => {
  try {
    const user = await loadFullUser(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(buildUserPayload(user));
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   PUT /data  (full save — used by save())
========================= */

router.put("/data", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const payload = req.body.data || req.body || {};
    const dataPayload = { ...payload };

    if (dataPayload.user) {
      const allowed = ['name', 'username', 'bio', 'bcoins', 'bucks', 'robux', 'points', 'tickets', 'bodyColorHead', 'bodyColorLimbs', 'equippedAccessory', 'equippedAcc', 'equippedClothing'];
      const savedUserData = {};
      Object.keys(dataPayload.user).forEach(key => {
        if (allowed.includes(key)) {
          savedUserData[key] = dataPayload.user[key];
          if (key === 'bucks' || key === 'robux' || key === 'bcoins') {
            user.bcoins = Number(dataPayload.user[key]) || 0;
            savedUserData.bcoins = user.bcoins;
            savedUserData.bucks = user.bcoins;
          } else if (key === 'tickets' || key === 'points') {
            user.points = Number(dataPayload.user[key]) || 0;
            savedUserData.points = user.points;
          } else if (key === 'username') {
            user.username = cleanUsername(dataPayload.user[key]) || user.username;
            savedUserData.username = user.username;
            savedUserData.name = user.username;
          } else if (key === 'name') {
            // display-name only — never touches the real schema username field
            savedUserData.name = String(dataPayload.user[key] || user.username).slice(0, 32);
          } else if (key === 'bio') {
            user.bio = String(dataPayload.user[key] || "").slice(0, 500);
            savedUserData.bio = user.bio;
          } else {
            user[key] = dataPayload.user[key];
            savedUserData[key] = dataPayload.user[key];
          }
        }
      });
      user.data = { ...(user.data || {}), user: { ...((user.data && user.data.user) || {}), ...savedUserData } };
      delete dataPayload.user;
    }

    user.data = { ...(user.data || {}), ...dataPayload };
    await user.save();

    return res.json({ success: true, data: user.data });
  } catch (err) {
    console.error("PUT /data ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   PATCH /data  (partial save — used by patch(), e.g. buy/equip)
========================= */

router.patch("/data", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const payload = req.body.data || req.body || {};
    const dataPayload = { ...payload };

    if (dataPayload.user) {
      const allowed = ['name', 'username', 'bio', 'bcoins', 'bucks', 'robux', 'points', 'tickets', 'bodyColorHead', 'bodyColorLimbs', 'equippedAccessory', 'equippedAcc', 'equippedClothing'];
      const savedUserData = {};
      Object.keys(dataPayload.user).forEach(key => {
        if (allowed.includes(key)) {
          savedUserData[key] = dataPayload.user[key];
          if (key === 'bucks' || key === 'robux' || key === 'bcoins') {
            user.bcoins = Number(dataPayload.user[key]) || 0;
            savedUserData.bcoins = user.bcoins;
            savedUserData.bucks = user.bcoins;
          } else if (key === 'tickets' || key === 'points') {
            user.points = Number(dataPayload.user[key]) || 0;
            savedUserData.points = user.points;
          } else if (key === 'username') {
            user.username = cleanUsername(dataPayload.user[key]) || user.username;
            savedUserData.username = user.username;
            savedUserData.name = user.username;
          } else if (key === 'name') {
            // display-name only — never touches the real schema username field
            savedUserData.name = String(dataPayload.user[key] || user.username).slice(0, 32);
          } else if (key === 'bio') {
            user.bio = String(dataPayload.user[key] || "").slice(0, 500);
            savedUserData.bio = user.bio;
          } else {
            user[key] = dataPayload.user[key];
            savedUserData[key] = dataPayload.user[key];
          }
        }
      });
      user.data = { ...(user.data || {}), user: { ...((user.data && user.data.user) || {}), ...savedUserData } };
      delete dataPayload.user;
    }

    user.data = { ...(user.data || {}), ...dataPayload };
    await user.save();

    return res.json({ success: true, data: user.data });
  } catch (err) {
    console.error("PATCH /data ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   DAILY POINT CLAIM
========================= */

router.post('/claim-daily', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = Date.now();
    const last = (user.data && user.data.lastPointClaim) ? new Date(user.data.lastPointClaim).getTime() : 0;
    const oneDay = 24 * 60 * 60 * 1000;

    if (now - last < oneDay) {
      const next = new Date(last + oneDay).toISOString();
      return res.json({ success: false, claimed: false, points: user.points || user.tickets || 0, nextClaim: next });
    }

    user.points = (user.points || 0) + 10;
    user.data = { ...(user.data || {}), lastPointClaim: new Date().toISOString() };
    await user.save();

    return res.json({ success: true, claimed: true, points: user.points });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
});

/* =========================
   EXCHANGE POINTS -> BCOINS
========================= */

router.post('/exchange-points', auth, async (req, res) => {
  try {
    const { points } = req.body || {};
    const pts = parseInt(points, 10) || 0;

    if (pts <= 0) return res.status(400).json({ message: 'Invalid points amount' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const userPoints = user.points || user.tickets || (user.data && user.data.points) || 0;
    if (userPoints < pts) return res.status(400).json({ message: 'Not enough points' });

    const bcoinsGain = Math.floor(pts / POINTS_PER_BCOIN);
    if (bcoinsGain <= 0) return res.status(400).json({ message: `Need at least ${POINTS_PER_BCOIN} points to convert` });

    const usedPoints = bcoinsGain * POINTS_PER_BCOIN;

    if (typeof user.points === 'number') {
      user.points = (user.points || 0) - usedPoints;
    } else if (user.tickets !== undefined) {
      user.tickets = (user.tickets || 0) - usedPoints;
    } else {
      user.data = { ...(user.data || {}), points: ((user.data && user.data.points) || 0) - usedPoints };
    }

    user.bcoins = (user.bcoins || 0) + bcoinsGain;
    await user.save();

    return res.json({ success: true, points: (user.points || user.tickets || (user.data && user.data.points) || 0), bcoins: user.bcoins, bcoinsGained: bcoinsGain });
  } catch (err) {
    console.error('Exchange error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* =========================
   FRIEND REQUEST
========================= */

router.post("/friends/request", auth, async (req, res) => {
  try {
    const { to } = req.body;

    if (!to)
      return res.status(400).json({ message: "Missing id" });

    if (to === req.user.id)
      return res.status(400).json({ message: "Self add blocked" });

    const me = await User.findById(req.user.id);
    const target = await User.findById(to);
    if (!me)
      return res.status(404).json({ message: "User not found" });
    if (!target)
      return res.status(404).json({ message: "User not found" });

    if (isBlockedBetween(me, target))
      return res.status(400).json({ message: "Cannot request this player" });

    const already =
      (target.friendRequests || []).some(id => id?.toString() === req.user.id) ||
      (target.friends || []).some(id => id?.toString() === req.user.id) ||
      (me.friends || []).some(id => id?.toString() === target._id.toString());

    if (already)
      return res.status(400).json({ message: "Already requested/friends" });

    target.friendRequests.push(req.user.id);
    await target.save();

    return res.json({ message: "Request sent" });

  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   FRIEND ACCEPT
========================= */

router.post("/friends/accept", auth, async (req, res) => {
  try {
    const { from } = req.body;

    const me = await User.findById(req.user.id);
    const fromUser = await User.findById(from);

    if (!me || !fromUser)
      return res.status(404).json({ message: "User not found" });

    const hasRequest = (me.friendRequests || []).some(
      id => id?.toString() === fromUser._id.toString()
    );

    if (!hasRequest)
      return res.status(400).json({ message: "No request" });

    me.friendRequests = removeId(me.friendRequests, fromUser._id);

    if (!(me.friends || []).some(id => id?.toString() === fromUser._id.toString())) {
      me.friends.push(fromUser._id);
    }
    if (!(fromUser.friends || []).some(id => id?.toString() === me._id.toString())) {
      fromUser.friends.push(me._id);
    }

    await me.save();
    await fromUser.save();

    return res.json({ message: "Friends now" });

  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/friends/decline", auth, async (req, res) => {
  try {
    const { from } = req.body;
    const me = await User.findById(req.user.id);
    if (!me) return res.status(404).json({ message: "User not found" });
    me.friendRequests = removeId(me.friendRequests, from);
    await me.save();
    return res.json({ message: "Request declined" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/friends/remove", auth, async (req, res) => {
  try {
    const { friendId } = req.body;
    const me = await User.findById(req.user.id);
    const friend = await User.findById(friendId);
    if (!me || !friend) return res.status(404).json({ message: "User not found" });

    me.friends = removeId(me.friends, friend._id);
    friend.friends = removeId(friend.friends, me._id);
    await me.save();
    await friend.save();

    return res.json({ message: "Friend removed" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/users/block", auth, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || userId === req.user.id) return res.status(400).json({ message: "Invalid player" });

    const me = await User.findById(req.user.id);
    const target = await User.findById(userId);
    if (!me || !target) return res.status(404).json({ message: "User not found" });

    if (!(me.blockedUsers || []).some(id => id?.toString() === target._id.toString())) {
      me.blockedUsers.push(target._id);
    }

    me.friends = removeId(me.friends, target._id);
    target.friends = removeId(target.friends, me._id);
    me.friendRequests = removeId(me.friendRequests, target._id);
    target.friendRequests = removeId(target.friendRequests, me._id);
    me.data = { ...(me.data || {}), blockedUsers: (me.data?.blockedUsers || []).filter(p => String(p.id || p._id) !== target._id.toString()) };
    me.data.blockedUsers.push(publicUser(target));

    await me.save();
    await target.save();

    return res.json({ message: "Player blocked" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/messages", auth, async (req, res) => {
  try {
    const to = String(req.body.to || "").trim();
    const subject = String(req.body.subject || "(no subject)").trim().slice(0, 80) || "(no subject)";
    const body = String(req.body.body || "").trim().slice(0, 2000);

    if (!to || !body) return res.status(400).json({ message: "Missing recipient or message" });

    const sender = await User.findById(req.user.id);
    const recipient = mongoose.Types.ObjectId.isValid(to) ? await User.findById(to) : await findUserByIdentifier(to);
    if (!sender || !recipient) return res.status(404).json({ message: "Player not found" });
    if (isBlockedBetween(sender, recipient)) return res.status(400).json({ message: "Cannot message this player" });

    const now = new Date().toLocaleDateString();
    const id = Date.now();
    const sentMessage = { id, from: sender.username, fromId: sender._id.toString(), to: recipient.username, toId: recipient._id.toString(), subject, body, date: now, read: true, sent: true };
    const inboxMessage = { ...sentMessage, id: id + 1, read: false, sent: false };

    sender.data = { ...(sender.data || {}), messages: [...((sender.data && sender.data.messages) || []), sentMessage] };
    recipient.data = { ...(recipient.data || {}), messages: [...((recipient.data && recipient.data.messages) || []), inboxMessage] };

    await sender.save();
    await recipient.save();

    return res.json({ success: true, message: sentMessage });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   ACCESSORIES
========================= */

router.get("/accessories", async (req, res) => {
  try {
    const items = await Accessory.find();
    return res.json({ accessories: items });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/accessories/buy", auth, async (req, res) => {
  try {
    const { accessoryId } = req.body;

    const item = await Accessory.findById(accessoryId);
    if (!item) {
      return res.status(404).json({ message: "Not found" });
    }

    const user = await User.findById(req.user.id);

    if (user.bcoins < item.price) {
      return res.status(400).json({ message: "Not enough coins" });
    }

    user.bcoins -= item.price;

    const owned = (user.inventory || []).some(
      i => String(i.id) === String(accessoryId)
    );

    if (!owned) {
      user.inventory.push({
        id: String(item._id),
        name: item.name,
        type: item.type || "accessory",
        icon: item.img || "",
        rarity: "Common",
        equipped: false
      });
    }

    await user.save();

    res.json({
      success: true,
      bcoins: user.bcoins,
      inventory: user.inventory
    });

  } catch (err) {
    console.error("ACCESSORIES/BUY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/accessories/equip", auth, async (req, res) => {
  try {
    const { accessoryId } = req.body;

    const user = await User.findById(req.user.id);

    const owns = (user.inventory || []).some(
      i => String(i.id) === String(accessoryId)
    );

    if (!owns) {
      return res.status(400).json({ message: "Not owned" });
    }

    user.equippedAcc = [String(accessoryId)];

    user.data = {
      ...(user.data || {}),
      user: {
        ...((user.data && user.data.user) || {}),
        equippedAcc: [String(accessoryId)]
      }
    };

    await user.save();

    res.json({
      success: true,
      equippedAcc: user.equippedAcc
    });

  } catch (err) {
    console.error("ACCESSORIES/EQUIP ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   SEARCH USERS
========================= */

router.get("/users", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ users: [] });

    const users = await User.find({
      username: { $regex: q, $options: "i" }
    }).limit(20).select("username bio data friends createdAt");

    return res.json({ users: users.map(publicUser) });

  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("username bio data friends createdAt");
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ user: publicUser(user) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
