// ===== server/server.js =====
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] },
});

// -------- Game / Tournament State --------
let players = [];          // [{ id, name }]
let deck = [];             // array of { color, value }
let handsById = {};        // { socketId: [cards] }
let topCard = null;        // current top of discard pile
let currentTurnIndex = 0;  // index into players[]
let direction = 1;         // +1 forward, -1 reverse

let unoPendingFor = null;  // socket id who must call UNO
let gameOver = false;      // tournament finished?

// Tournament scoring
let scores = {};           // cumulative penalty points: { socketId: number }
let targetScore = 500;     // eliminate at or above this threshold

const mod = (n, m) => ((n % m) + m) % m;

// -------- Helpers --------
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
function giveCards(playerId, n) {
  const drawn = deck.splice(0, n);
  drawn.forEach((d) => {
    (handsById[playerId] ||= []).push(d);
    io.to(playerId).emit("card-drawn", d);
  });
}
function advanceTurn(steps = 1) {
  if (players.length === 0) return;
  currentTurnIndex = mod(currentTurnIndex + steps * direction, players.length);
}

// Card values for scoring
function cardPoints(c) {
  if (c.value === "wild" || c.value === "draw4") return 50;
  if (c.value === "skip" || c.value === "reverse" || c.value === "draw2") return 20;
  const n = Number(c.value);
  return Number.isFinite(n) ? n : 0;
}
function handPoints(hand = []) {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

// Get a valid starting card (no wilds or draw4s)
function getValidStartCard(deckArray) {
  let cardIndex = 0;
  while (cardIndex < deckArray.length) {
    const card = deckArray[cardIndex];
    if (card.value !== "wild" && card.value !== "draw4") {
      // Remove this card from deck and return it
      return deckArray.splice(cardIndex, 1)[0];
    }
    cardIndex++;
  }
  // Fallback - shouldn't happen with a proper deck
  return deckArray.shift();
}

// Start a *round* with current players (scores persist)
function startRound() {
  deck = shuffleDeck(createDeck());
  handsById = dealHands(players, deck);
  
  // Get a valid starting card (no wilds or draw4s)
  topCard = getValidStartCard(deck);
  
  currentTurnIndex = 0;
  direction = 1;
  unoPendingFor = null;

  io.emit("game-started", {
    hands: handsById,
    topCard,
    currentPlayerId: players[currentTurnIndex]?.id || null,
    scores,                 // NEW: send cumulative scores
    targetScore,            // for UI display
    playerOrder: players,   // keep client aligned if needed
  });
}

// End a *round* (somebody went out): score others, update totals, eliminate, continue or end.
function endRound(winnerId) {
  // Build scoring breakdown
  const breakdown = players.map((p) => {
    const added = p.id === winnerId ? 0 : handPoints(handsById[p.id] || []);
    scores[p.id] = (scores[p.id] || 0) + added;
    return { playerId: p.id, name: p.name, added, total: scores[p.id] };
  });

  // Eliminations
  const eliminatedIds = [];
  players = players.filter((p) => {
    if ((scores[p.id] || 0) >= targetScore) {
      eliminatedIds.push(p.id);
      delete handsById[p.id];
      return false;
    }
    return true;
  });

  // Adjust currentTurnIndex into new players list
  currentTurnIndex = 0;
  direction = 1;
  unoPendingFor = null;

  // Tournament winner?
  if (players.length <= 1) {
    gameOver = true;
    const champion = players[0] || null;
    io.emit("tournament-won", {
      championId: champion?.id || null,
      championName: champion?.name || "No one",
      scores,
      breakdown,
      eliminatedIds,
      targetScore,
    });
    return;
  }

  // Inform clients and auto-start next round after a short delay
  io.emit("round-ended", {
    winnerId,
    scores,
    breakdown,
    eliminatedIds,
    targetScore,
  });

  setTimeout(() => startRound(), 2500);
}

function settlePendingUnoBeforeAction() {
  if (!unoPendingFor) return;
  const offender = unoPendingFor;
  unoPendingFor = null;
  giveCards(offender, 2);
  io.emit("uno-result", { playerId: offender, ok: false, penalty: 2 });
}

// -------- Socket.IO --------
io.on("connection", (socket) => {
  socket.on("new-player", (username) => {
    if (gameOver) return;
    players.push({ id: socket.id, name: username });
    scores[socket.id] = scores[socket.id] || 0;
    io.emit("update-players", players);
  });

  socket.on("start-game", () => {
    if (players.length === 0) return;
    // Fresh tournament: reset scores and flags
    scores = {};
    players.forEach((p) => (scores[p.id] = 0));
    gameOver = false;
    startRound();
  });

  // Optional: host could change target score
  socket.on("set-target-score", (val) => {
    const allowed = [100, 200, 300, 400, 500, 1000];
    if (allowed.includes(Number(val))) {
      targetScore = Number(val);
      io.emit("scores-updated", { scores, targetScore });
    }
  });

  // Declare UNO (button)
  socket.on("declare-uno", () => {
    if (gameOver) return;
    const me = socket.id;
    const myCount = (handsById[me] || []).length;
    if (unoPendingFor === me && myCount === 1) {
      unoPendingFor = null;
      io.emit("uno-result", { playerId: me, ok: true, penalty: 0 });
    } else {
      socket.emit("invalid-play", { message: "UNO not required or wrong timing." });
    }
  });

  // Play a card
  socket.on("play-card", ({ card, unoDeclared = false }) => {
    if (gameOver) return;

    settlePendingUnoBeforeAction();

    const me = socket.id;
    const myIdx = players.findIndex((p) => p.id === me);
    if (myIdx !== currentTurnIndex) return; // not your turn

    if (card.value === "draw4" && hasColorInHand(handsById[me] || [], topCard.color)) {
      return socket.emit("invalid-play", {
        message: `Cannot play Draw 4 when you have ${topCard.color} cards.`,
      });
    }

    if (!isPlayable(card, topCard)) {
      return socket.emit("invalid-play", { message: "Invalid card play." });
    }

    // Remove exactly ONE copy of the played card
    function sameCard(a, b) {
      if (b.value === "wild" || b.value === "draw4") return a.value === b.value;
      return a.color === b.color && a.value === b.value;
    }
    
    // FIXED: Remove only the FIRST matching card, not all matches
    const myHand = handsById[me] || [];
    const cardIndex = myHand.findIndex(c => sameCard(c, card));
    if (cardIndex !== -1) {
      handsById[me].splice(cardIndex, 1);
    }

    topCard = card;

    // Round end or UNO window
    const remaining = (handsById[me]?.length ?? 0);

    if (remaining === 0) {
      // Round ends immediately – score others, then new round or tournament end
      io.emit("update-hands", handsById);
      io.emit("card-played", { card, playerId: me, nextPlayerId: null, topCard });
      endRound(me);
      return;
    }

    if (remaining === 1) {
      if (unoDeclared === true) {
        if (unoPendingFor === me) unoPendingFor = null;
        io.emit("uno-result", { playerId: me, ok: true, penalty: 0 });
      } else if (unoPendingFor !== me) {
        unoPendingFor = me;
        io.emit("uno-window", { playerId: me });
      }
    } else {
      if (unoPendingFor === me) unoPendingFor = null;
    }

    // Action cards / advance
    switch (card.value) {
      case "skip":
        advanceTurn(2);
        break;
      case "reverse":
        direction *= -1;
        if (players.length !== 2) advanceTurn(1);
        break;
      case "draw2": {
        const nextIdx = mod(currentTurnIndex + direction, players.length);
        const nextId = players[nextIdx].id;
        giveCards(nextId, 2);
        advanceTurn(2);
        break;
      }
      case "draw4": {
        const nextIdx4 = mod(currentTurnIndex + direction, players.length);
        const nextId4 = players[nextIdx4].id;
        giveCards(nextId4, 4);
        advanceTurn(2);
        break;
      }
      default:
        advanceTurn(1);
    }

    io.emit("card-played", {
      card,
      playerId: me,
      nextPlayerId: players[currentTurnIndex]?.id || null,
      topCard,
    });
    io.emit("update-hands", handsById);
  });

  // Draw a card (no playable card)
  socket.on("draw-card", () => {
    if (gameOver) return;

    settlePendingUnoBeforeAction();

    const me = socket.id;
    const myIdx = players.findIndex((p) => p.id === me);
    if (myIdx !== currentTurnIndex) return;

    const drawn = deck.shift();
    if (!drawn) return;

    (handsById[me] ||= []).push(drawn);
    socket.emit("card-drawn", drawn);

    const canPlayDrawn =
      isPlayable(drawn, topCard) &&
      !(drawn.value === "draw4" && hasColorInHand(handsById[me], topCard.color));

    if (!canPlayDrawn) {
      advanceTurn(1);
      io.emit("turn-changed", players[currentTurnIndex]?.id || null);
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    const leavingIndex = players.findIndex((p) => p.id === socket.id);
    players = players.filter((p) => p.id !== socket.id);
    delete handsById[socket.id];

    if (!gameOver && players.length > 0) {
      if (leavingIndex !== -1 && leavingIndex <= currentTurnIndex) {
        currentTurnIndex = mod(currentTurnIndex - 1, players.length);
      }
      if (unoPendingFor === socket.id) unoPendingFor = null;
    }

    io.emit("update-players", players);
    io.emit("update-hands", handsById);
  });
});

// -------- Boot --------
server.listen(3001, () => console.log("🚀 Server running on port 3001"));

// -------- Deck helpers --------
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