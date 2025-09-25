// ===== server/server.js =====
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// Updated CORS configuration for all Vercel deployment patterns
app.use(cors({
  origin: [
    "https://unogame-eta.vercel.app",                    // Production
    "https://unogame-git-main-lucas-washingtons-projects.vercel.app", // Git branch
    /^https:\/\/unogame-.*\.vercel\.app$/,               // All unogame preview deployments
    /^https:\/\/.*-lucas-washingtons-projects\.vercel\.app$/, // All project deployments
    "http://localhost:3000",                             // Local development
    "http://localhost:5173",                             // Vite dev server
    "http://localhost:3001",                             // Local backend
    "https://uno-game-server-saq7.onrender.com"         // Render backend
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// Updated Socket.IO CORS configuration
const io = new Server(server, {
  cors: {
    origin: [
      "https://unogame-eta.vercel.app",                  // Production
      "https://unogame-git-main-lucas-washingtons-projects.vercel.app", // Git branch
      /^https:\/\/unogame-.*\.vercel\.app$/,             // All unogame preview deployments
      /^https:\/\/.*-lucas-washingtons-projects\.vercel\.app$/, // All project deployments
      "http://localhost:3000", 
      "http://localhost:5173",                           // Vite dev server
      "http://localhost:3001",
      "https://uno-game-server-saq7.onrender.com"       // Render backend
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'UNO Server Running', 
    rooms: rooms.size, 
    totalPlayers: getTotalPlayers(),
    time: new Date() 
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    connections: io.sockets.sockets.size,
    activeRooms: rooms.size 
  });
});

// -------- Room-Based Game State --------
const rooms = new Map(); // roomId -> roomData
const playerRooms = new Map(); // socketId -> roomId

const MAX_PLAYERS_PER_ROOM = 8;
const mod = (n, m) => ((n % m) + m) % m;

// Room structure
function createRoomData() {
  return {
    // Room info
    id: '',
    status: 'waiting', // 'waiting', 'active', 'finished'
    host: null,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    
    // Game state (same as before but per room)
    players: [],
    deck: [],
    handsById: {},
    topCard: null,
    currentTurnIndex: 0,
    direction: 1,
    unoPendingFor: null,
    gameOver: false,
    scores: {},
    targetScore: 500,
    
    // Timestamps
    created: new Date(),
    lastActivity: new Date()
  };
}

// -------- Room Management --------
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(hostId, customRoomId = null) {
  const roomId = customRoomId || generateRoomId();
  
  if (rooms.has(roomId)) {
    return { success: false, error: 'Room already exists' };
  }
  
  const roomData = createRoomData();
  roomData.id = roomId;
  roomData.host = hostId;
  
  rooms.set(roomId, roomData);
  console.log(`Room ${roomId} created by ${hostId}`);
  
  return { success: true, roomId, roomData };
}

function joinRoom(roomId, playerId, playerName) {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }
  
  if (room.status === 'active') {
    return { success: false, error: 'Game in progress' };
  }
  
  if (room.players.length >= room.maxPlayers) {
    return { success: false, error: 'Room is full' };
  }
  
  if (room.players.some(p => p.id === playerId)) {
    return { success: false, error: 'Already in room' };
  }
  
  // Add player to room
  room.players.push({ id: playerId, name: playerName });
  room.scores[playerId] = 0;
  room.lastActivity = new Date();
  
  // Track player's room
  playerRooms.set(playerId, roomId);
  
  console.log(`Player ${playerName} (${playerId}) joined room ${roomId}`);
  return { success: true, room };
}

function leaveRoom(playerId) {
  const roomId = playerRooms.get(playerId);
  if (!roomId) return { success: false, error: 'Not in a room' };
  
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'Room not found' };
  
  // Remove player from room
  room.players = room.players.filter(p => p.id !== playerId);
  delete room.handsById[playerId];
  delete room.scores[playerId];
  
  // Clear UNO pending if it was this player
  if (room.unoPendingFor === playerId) {
    room.unoPendingFor = null;
  }
  
  // Adjust turn index if needed
  if (room.players.length > 0 && room.currentTurnIndex >= room.players.length) {
    room.currentTurnIndex = 0;
  }
  
  playerRooms.delete(playerId);
  
  // Transfer host if host left and room not empty
  if (room.host === playerId && room.players.length > 0) {
    room.host = room.players[0].id;
  }
  
  // Clean up empty room
  if (room.players.length === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted - empty`);
  } else {
    room.lastActivity = new Date();
  }
  
  return { success: true, roomId, room };
}

function getRoomsList() {
  const roomsList = [];
  rooms.forEach((room, roomId) => {
    if (room.status === 'waiting') {
      roomsList.push({
        id: roomId,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
        host: room.players.find(p => p.id === room.host)?.name || 'Unknown',
        created: room.created
      });
    }
  });
  return roomsList;
}

function getTotalPlayers() {
  let total = 0;
  rooms.forEach(room => {
    total += room.players.length;
  });
  return total;
}

// -------- Game Helper Functions (Room-Aware) --------
function isPlayable(card, top) {
  return (
    card.color === top.color ||
    card.value === top.value ||
    card.value === "wild" ||
    card.value === "draw4"
  );
}

function hasColorInHand(hand, color) {
  return hand.some((c) => c.color === color);
}

function giveCards(roomId, playerId, n) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const drawn = room.deck.splice(0, n);
  drawn.forEach((d) => {
    (room.handsById[playerId] ||= []).push(d);
    io.to(playerId).emit("card-drawn", d);
  });
}

function advanceTurn(roomId, steps = 1) {
  const room = rooms.get(roomId);
  if (!room || room.players.length === 0) return;
  room.currentTurnIndex = mod(room.currentTurnIndex + steps * room.direction, room.players.length);
}

function cardPoints(c) {
  if (c.value === "wild" || c.value === "draw4") return 50;
  if (c.value === "skip" || c.value === "reverse" || c.value === "draw2") return 20;
  const n = Number(c.value);
  return Number.isFinite(n) ? n : 0;
}

function handPoints(hand = []) {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

function getValidStartCard(deckArray) {
  let cardIndex = 0;
  while (cardIndex < deckArray.length) {
    const card = deckArray[cardIndex];
    if (card.value !== "wild" && card.value !== "draw4") {
      return deckArray.splice(cardIndex, 1)[0];
    }
    cardIndex++;
  }
  return deckArray.shift();
}

function startRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.deck = shuffleDeck(createDeck());
  room.handsById = dealHands(room.players, room.deck);
  room.topCard = getValidStartCard(room.deck);
  room.currentTurnIndex = 0;
  room.direction = 1;
  room.unoPendingFor = null;
  room.lastActivity = new Date();

  io.to(roomId).emit("game-started", {
    hands: room.handsById,
    topCard: room.topCard,
    currentPlayerId: room.players[room.currentTurnIndex]?.id || null,
    scores: room.scores,
    targetScore: room.targetScore,
    playerOrder: room.players,
  });
}

function endRound(roomId, winnerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const breakdown = room.players.map((p) => {
    const added = p.id === winnerId ? 0 : handPoints(room.handsById[p.id] || []);
    room.scores[p.id] = (room.scores[p.id] || 0) + added;
    return { playerId: p.id, name: p.name, added, total: room.scores[p.id] };
  });

  const eliminatedIds = [];
  room.players = room.players.filter((p) => {
    if ((room.scores[p.id] || 0) >= room.targetScore) {
      eliminatedIds.push(p.id);
      delete room.handsById[p.id];
      return false;
    }
    return true;
  });

  room.currentTurnIndex = 0;
  room.direction = 1;
  room.unoPendingFor = null;

  if (room.players.length <= 1) {
    room.gameOver = true;
    room.status = 'finished';
    const champion = room.players[0] || null;
    
    io.to(roomId).emit("tournament-won", {
      championId: champion?.id || null,
      championName: champion?.name || "No one",
      scores: room.scores,
      breakdown,
      eliminatedIds,
      targetScore: room.targetScore,
    });
    
    // Auto-cleanup finished rooms after 5 minutes
    setTimeout(() => {
      if (rooms.has(roomId) && room.status === 'finished') {
        rooms.delete(roomId);
        console.log(`Room ${roomId} auto-deleted - finished`);
      }
    }, 300000); // 5 minutes
    
    return;
  }

  io.to(roomId).emit("round-ended", {
    winnerId,
    scores: room.scores,
    breakdown,
    eliminatedIds,
    targetScore: room.targetScore,
  });

  setTimeout(() => startRound(roomId), 2500);
}

function settlePendingUnoBeforeAction(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.unoPendingFor) return;
  
  const offender = room.unoPendingFor;
  room.unoPendingFor = null;
  giveCards(roomId, offender, 2);
  io.to(roomId).emit("uno-result", { playerId: offender, ok: false, penalty: 2 });
}

// -------- Socket Events --------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Room management events
  socket.on("create-room", ({ roomId, playerName }) => {
    const result = createRoom(socket.id, roomId);
    
    if (result.success) {
      socket.join(result.roomId);
      joinRoom(result.roomId, socket.id, playerName);
      
      socket.emit("room-created", { 
        roomId: result.roomId, 
        room: rooms.get(result.roomId) 
      });
      
      io.to(result.roomId).emit("room-updated", rooms.get(result.roomId));
    } else {
      socket.emit("room-error", { message: result.error });
    }
  });
  
  socket.on("join-room", ({ roomId, playerName }) => {
    const result = joinRoom(roomId, socket.id, playerName);
    
    if (result.success) {
      socket.join(roomId);
      socket.emit("room-joined", { roomId, room: result.room });
      io.to(roomId).emit("room-updated", result.room);
    } else {
      socket.emit("room-error", { message: result.error });
    }
  });
  
  socket.on("leave-room", () => {
    const result = leaveRoom(socket.id);
    if (result.success) {
      socket.leave(result.roomId);
      socket.emit("room-left");
      if (result.room) {
        io.to(result.roomId).emit("room-updated", result.room);
      }
    }
  });
  
  socket.on("get-rooms", () => {
    socket.emit("rooms-list", getRoomsList());
  });

  // Game events (room-aware)
  socket.on("start-game", () => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.host !== socket.id) return;
    if (room.players.length === 0) return;
    
    // Reset scores and start tournament
    room.scores = {};
    room.players.forEach((p) => (room.scores[p.id] = 0));
    room.gameOver = false;
    room.status = 'active';
    
    startRound(roomId);
  });

  socket.on("set-target-score", (val) => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.host !== socket.id) return;
    
    const allowed = [100, 200, 300, 400, 500, 1000];
    if (allowed.includes(Number(val))) {
      room.targetScore = Number(val);
      io.to(roomId).emit("scores-updated", { scores: room.scores, targetScore: room.targetScore });
    }
  });

  socket.on("declare-uno", () => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.gameOver) return;
    
    const me = socket.id;
    const myCount = (room.handsById[me] || []).length;
    if (room.unoPendingFor === me && myCount === 1) {
      room.unoPendingFor = null;
      io.to(roomId).emit("uno-result", { playerId: me, ok: true, penalty: 0 });
    } else {
      socket.emit("invalid-play", { message: "UNO not required or wrong timing." });
    }
  });

  socket.on("play-card", ({ card, unoDeclared = false }) => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.gameOver || room.status !== 'active') return;

    settlePendingUnoBeforeAction(roomId);

    const me = socket.id;
    const myIdx = room.players.findIndex((p) => p.id === me);
    if (myIdx !== room.currentTurnIndex) return;

    if (card.value === "draw4" && hasColorInHand(room.handsById[me] || [], room.topCard.color)) {
      return socket.emit("invalid-play", {
        message: `Cannot play Draw 4 when you have ${room.topCard.color} cards.`,
      });
    }

    if (!isPlayable(card, room.topCard)) {
      return socket.emit("invalid-play", { message: "Invalid card play." });
    }

    function sameCard(a, b) {
      if (b.value === "wild" || b.value === "draw4") return a.value === b.value;
      return a.color === b.color && a.value === b.value;
    }
    
    const myHand = room.handsById[me] || [];
    const cardIndex = myHand.findIndex(c => sameCard(c, card));
    if (cardIndex !== -1) {
      room.handsById[me].splice(cardIndex, 1);
    }

    room.topCard = card;
    room.lastActivity = new Date();
    const remaining = (room.handsById[me]?.length ?? 0);

    if (remaining === 0) {
      io.to(roomId).emit("update-hands", room.handsById);
      io.to(roomId).emit("card-played", { card, playerId: me, nextPlayerId: null, topCard: room.topCard });
      endRound(roomId, me);
      return;
    }

    if (remaining === 1) {
      if (unoDeclared === true) {
        if (room.unoPendingFor === me) room.unoPendingFor = null;
        io.to(roomId).emit("uno-result", { playerId: me, ok: true, penalty: 0 });
      } else if (room.unoPendingFor !== me) {
        room.unoPendingFor = me;
        io.to(roomId).emit("uno-window", { playerId: me });
      }
    } else {
      if (room.unoPendingFor === me) room.unoPendingFor = null;
    }

    switch (card.value) {
      case "skip":
        advanceTurn(roomId, 2);
        break;
      case "reverse":
        room.direction *= -1;
        if (room.players.length !== 2) advanceTurn(roomId, 1);
        break;
      case "draw2": {
        const nextIdx = mod(room.currentTurnIndex + room.direction, room.players.length);
        const nextId = room.players[nextIdx].id;
        giveCards(roomId, nextId, 2);
        advanceTurn(roomId, 2);
        break;
      }
      case "draw4": {
        const nextIdx4 = mod(room.currentTurnIndex + room.direction, room.players.length);
        const nextId4 = room.players[nextIdx4].id;
        giveCards(roomId, nextId4, 4);
        advanceTurn(roomId, 2);
        break;
      }
      default:
        advanceTurn(roomId, 1);
    }

    io.to(roomId).emit("card-played", {
      card,
      playerId: me,
      nextPlayerId: room.players[room.currentTurnIndex]?.id || null,
      topCard: room.topCard,
    });
    io.to(roomId).emit("update-hands", room.handsById);
  });

  socket.on("draw-card", () => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.gameOver || room.status !== 'active') return;

    settlePendingUnoBeforeAction(roomId);

    const me = socket.id;
    const myIdx = room.players.findIndex((p) => p.id === me);
    if (myIdx !== room.currentTurnIndex) return;

    const drawn = room.deck.shift();
    if (!drawn) return;

    (room.handsById[me] ||= []).push(drawn);
    socket.emit("card-drawn", drawn);
    room.lastActivity = new Date();

    const canPlayDrawn =
      isPlayable(drawn, room.topCard) &&
      !(drawn.value === "draw4" && hasColorInHand(room.handsById[me], room.topCard.color));

    if (!canPlayDrawn) {
      advanceTurn(roomId, 1);
      io.to(roomId).emit("turn-changed", room.players[room.currentTurnIndex]?.id || null);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    leaveRoom(socket.id);
  });
});

// -------- Start Server --------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`UNO Server running on port ${PORT}`);
});

// Cleanup old rooms every 30 minutes
setInterval(() => {
  const now = new Date();
  const cutoff = 30 * 60 * 1000; // 30 minutes
  
  rooms.forEach((room, roomId) => {
    if (now - room.lastActivity > cutoff) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} auto-deleted - inactive`);
    }
  });
}, 30 * 60 * 1000);

// -------- Deck Functions --------
function createDeck() {
  const colors = ["red", "green", "blue", "yellow"];
  const values = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","draw2"];
  const out = [];
  colors.forEach((color) => {
    values.forEach((value) => {
      out.push({ color, value });
      if (value !== "0") out.push({ color, value });
    });
  });
  for (let i = 0; i < 4; i++) {
    out.push({ color: "wild", value: "wild" });
    out.push({ color: "wild", value: "draw4" });
  }
  return out;
}

function shuffleDeck(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealHands(playersList, deckArr) {
  const hands = {};
  playersList.forEach((p) => (hands[p.id] = deckArr.splice(0, 7)));
  return hands;
}