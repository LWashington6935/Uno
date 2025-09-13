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

// -------- Game State --------
let players = [];          // [{ id, name }]
let deck = [];             // array of { id, color, value }
let handsById = {};        // { socketId: [cards] }
let topCard = null;        // current top of discard pile
let currentTurnIndex = 0;  // index into players[]
let direction = 1;         // +1 forward, -1 reverse
let gameOver = false;
let unoPendingFor = null;  // socket id of player who must call UNO
let nextCardId = 1;        // NEW: unique id generator

const mod = (n, m) => ((n % m) + m) % m;

// -------- Helpers --------
function isPlayable(card, top) {
  // wild/draw4 always playable (client sets chosen color for wilds)
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
function checkWin(playerId) {
  if ((handsById[playerId] || []).length === 0) {
    const winner = players.find((p) => p.id === playerId);
    gameOver = true;
    unoPendingFor = null; // clear any stray UNO state
    io.emit("game-won", { playerId, name: winner?.name || "Player" });
    return true;
  }
  return false;
}
// Penalize any unresolved UNO *before any new action by anyone*.
function settlePendingUnoBeforeAction() {
  if (!unoPendingFor) return;
  const offender = unoPendingFor;
  unoPendingFor = null;
  giveCards(offender, 2);
  io.emit("uno-result", { playerId: offender, ok: false, penalty: 2 });
}

// -------- Socket.IO --------
io.on("connection", (socket) => {
  // Lobby
  socket.on("new-player", (username) => {
    if (gameOver) return;
    players.push({ id: socket.id, name: username });
    io.emit("update-players", players);
  });

  // Start game
  socket.on("start-game", () => {
    if (players.length === 0) return;
    deck = shuffleDeck(createDeck());
    handsById = dealHands(players, deck);
    topCard = deck.shift();
    currentTurnIndex = 0;
    direction = 1;
    gameOver = false;
    unoPendingFor = null;

    io.emit("game-started", {
      hands: handsById,
      topCard,
      currentPlayerId: players[currentTurnIndex]?.id,
    });
  });

  // Declare UNO (button)
  socket.on("declare-uno", () => {
    if (gameOver) return;
    const me = socket.id;
    const myCount = (handsById[me] || []).length;

    // Only valid if you currently have exactly 1 card and you are the pending player
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

    // Penalize any unresolved UNO before processing this action
    settlePendingUnoBeforeAction();

    const me = socket.id;
    const myIdx = players.findIndex((p) => p.id === me);
    if (myIdx !== currentTurnIndex) return; // not your turn

    // Draw4 legality: only if you have no card of the current top color
    if (card.value === "draw4" && hasColorInHand(handsById[me] || [], topCard.color)) {
      return socket.emit("invalid-play", {
        message: `Cannot play Draw 4 when you have ${topCard.color} cards.`,
      });
    }

    // Validate play
    if (!isPlayable(card, topCard)) {
      return socket.emit("invalid-play", { message: "Invalid card play." });
    }

    // ---- Remove EXACTLY the played card by unique id ----
    handsById[me] = (handsById[me] || []).filter(c => c.id !== card.id);

    // Place on top (carry the same id; for wilds the client already set chosen color)
    topCard = { ...card };

    // --- Win / UNO flow (must run before advancing the turn) ---
    const remaining = (handsById[me]?.length ?? 0);

    // 1) Win takes precedence
    if (remaining === 0) {
      const winner = players.find((p) => p.id === me);
      gameOver = true;
      unoPendingFor = null;
      io.emit("game-won", { playerId: me, name: winner?.name || "Player" });

      io.emit("update-hands", handsById);
      io.emit("card-played", { card: topCard, playerId: me, nextPlayerId: null, topCard });
      return;
    }

    // 2) UNO: exactly 1 card
    if (remaining === 1) {
      if (unoDeclared === true) {
        if (unoPendingFor === me) unoPendingFor = null;
        io.emit("uno-result", { playerId: me, ok: true, penalty: 0 });
      } else if (unoPendingFor !== me) {
        // Open a pending UNO window until the *next* action occurs
        unoPendingFor = me;
        io.emit("uno-window", { playerId: me });
      }
    } else {
      // Any other hand size cancels a pending UNO for this player
      if (unoPendingFor === me) unoPendingFor = null;
    }

    // Resolve action cards & advance turn
    switch (topCard.value) {
      case "skip":
        advanceTurn(2);
        break;

      case "reverse":
        // Reverse flips direction. With 2 players, it acts like skip (same player goes again).
        direction *= -1;
        if (players.length === 2) {
          // same player goes again (no advance)
        } else {
          advanceTurn(1);
        }
        break;

      case "draw2": {
        const nextIdx = mod(currentTurnIndex + direction, players.length);
        const nextId = players[nextIdx].id;
        giveCards(nextId, 2);
        advanceTurn(2); // penalized player is skipped
        break;
      }

      case "draw4": {
        const nextIdx4 = mod(currentTurnIndex + direction, players.length);
        const nextId4 = players[nextIdx4].id;
        giveCards(nextId4, 4);
        advanceTurn(2); // penalized player is skipped
        break;
      }

      default:
        // normal number/color match
        advanceTurn(1);
    }

    io.emit("card-played", {
      card: topCard,
      playerId: me,
      nextPlayerId: players[currentTurnIndex]?.id || null,
      topCard,
    });
    io.emit("update-hands", handsById);
  });

  // Draw a card (only when player has no playable card).
  // If the drawn card is playable (respecting Draw4 legality), the player may
  // immediately click it to play (we keep the turn). Otherwise, the turn ends.
  socket.on("draw-card", () => {
    if (gameOver) return;

    // Penalize any unresolved UNO before processing this action
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
      // cannot play → end turn now
      advanceTurn(1);
      io.emit("turn-changed", players[currentTurnIndex]?.id || null);
    }
    // else: keep the same turn; player can click the drawn card to play it
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
const makeCard = (color, value) => ({ id: nextCardId++, color, value }); // NEW

function createDeck() {
  const colors = ["red", "green", "blue", "yellow"];
  const values = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","draw2"];
  const out = [];
  colors.forEach((color) => {
    values.forEach((value) => {
      out.push(makeCard(color, value));
      if (value !== "0") out.push(makeCard(color, value));
    });
  });
  for (let i = 0; i < 4; i++) {
    out.push(makeCard("wild", "wild"));
    out.push(makeCard("wild", "draw4"));
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
