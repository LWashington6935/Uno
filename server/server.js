const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

let OpenAI;
let openai;

// Try to load OpenAI, but don't fail if it's not installed
try {
  OpenAI = require("openai");
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} catch (error) {
  console.log("OpenAI not installed - AI features disabled");
  openai = null;
}

const app = express();

// Simple CORS - allow all origins for development
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// Simple Socket.IO CORS - allow all origins for development
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// -------- Room-Based Game State --------
const rooms = new Map();
const playerRooms = new Map();
const aiPlayers = new Map();

const MAX_PLAYERS_PER_ROOM = 4; // Changed from 8 to 4
const mod = (n, m) => ((n % m) + m) % m;

// Family AI names that cycle through
const FAMILY_AI_NAMES = ["Cuz Whitney", "Cuz Royce", "Uncle Ronnie"];
let familyNameIndex = 0;

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'UNO Server Running', 
    rooms: rooms.size, 
    totalPlayers: getTotalPlayers(),
    aiEnabled: !!process.env.OPENAI_API_KEY && !!openai,
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

// AI Player Management with family names
const AI_DIFFICULTIES = {
  easy: { strategy: "play_random" },
  medium: { strategy: "play_smart" },
  hard: { strategy: "play_strategic" }
};

function createAIPlayer(difficulty = 'medium') {
  const aiId = `ai_${Math.random().toString(36).substring(2, 8)}`;
  const familyName = FAMILY_AI_NAMES[familyNameIndex % FAMILY_AI_NAMES.length];
  familyNameIndex++;
  
  aiPlayers.set(aiId, {
    id: aiId,
    name: familyName,
    difficulty,
    strategy: AI_DIFFICULTIES[difficulty].strategy,
    isAI: true
  });
  
  return aiPlayers.get(aiId);
}

function removeAIPlayer(aiId) {
  aiPlayers.delete(aiId);
}

// Room structure
function createRoomData() {
  return {
    id: '',
    status: 'waiting',
    host: null,
    maxPlayers: MAX_PLAYERS_PER_ROOM, // Now 4 instead of 8
    allowAI: false,
    
    players: [],
    deck: [],
    handsById: {},
    topCard: null,
    currentTurnIndex: 0,
    direction: 1,
    unoPendingFor: null,
    gameOver: false,
    scores: {},
    targetScore: 500, // Default target score
    
    created: new Date(),
    lastActivity: new Date()
  };
}

// -------- Enhanced AI Game Logic --------
async function makeAIMove(roomId, aiPlayerId) {
  const room = rooms.get(roomId);
  const aiPlayer = aiPlayers.get(aiPlayerId);
  
  if (!room || !aiPlayer || room.status !== 'active') return;
  
  const aiHand = room.handsById[aiPlayerId] || [];
  const currentPlayer = room.players[room.currentTurnIndex];
  
  if (currentPlayer?.id !== aiPlayerId) return;
  
  try {
    console.log(`Family member ${aiPlayer.name} is thinking...`);
    
    // Get AI decision
    const decision = await getAIDecision(aiHand, room.topCard, aiPlayer.difficulty, room);
    
    // Execute AI decision
    await executeAIDecision(roomId, aiPlayerId, decision);
    
  } catch (error) {
    console.error(`AI move failed for ${aiPlayerId}:`, error);
    executeAIFallback(roomId, aiPlayerId);
  }
}

async function getAIDecision(hand, topCard, difficulty, room) {
  // Always use the simple AI - it's more reliable than OpenAI for UNO rules
  const decision = getSimpleAIDecision(hand, topCard);
  
  // Only use OpenAI for very hard difficulty and as a backup validator
  if (difficulty === 'hard' && process.env.OPENAI_API_KEY && openai) {
    try {
      const openaiDecision = await getOpenAIDecision(hand, topCard, difficulty);
      
      // Validate OpenAI decision against rules
      if (isValidAIDecision(openaiDecision, hand, topCard)) {
        console.log(`OpenAI decision validated: using OpenAI choice`);
        return openaiDecision;
      } else {
        console.log(`OpenAI decision invalid: falling back to rule-based AI`);
        return decision;
      }
    } catch (error) {
      console.error("OpenAI failed, using rule-based AI:", error);
      return decision;
    }
  }
  
  return decision;
}

async function getOpenAIDecision(hand, topCard, difficulty) {
  const playableCards = getPlayableCards(hand, topCard);
  
  const prompt = `You are an expert UNO player. Current situation:

Hand: ${hand.map(c => `${c.color} ${c.value}`).join(', ')}
Top card: ${topCard.color} ${topCard.value}
Playable cards: ${playableCards.map(c => `${c.color} ${c.value}`).join(', ')}

UNO RULES (CRITICAL):
1. You can ONLY play cards that match the top card's COLOR or VALUE
2. Wild cards can ALWAYS be played
3. Draw 4 can ONLY be played if you have NO cards matching the top card's COLOR
4. If you have playable cards, you MUST play one (never draw)

STRATEGY: Play the HIGHEST point value card from your playable options:
- Wild/Draw4 = 50 points
- Skip/Reverse/Draw2 = 20 points  
- Numbers = face value

Valid playable cards: ${playableCards.map(c => `${c.color} ${c.value} (${getCardPoints(c)}pts)`).join(', ')}

If you choose a wild card, pick the color you have most of: ${getBestColorForHand(hand)}

Response format:
{"action": "play_card", "card": {"color": "red", "value": "9"}}
OR for wilds:
{"action": "play_card", "card": {"color": "wild", "value": "wild"}, "chosen_color": "blue"}
OR:
{"action": "draw_card"}

Choose the highest point playable card!`;

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "You are a UNO expert. Follow rules exactly. Only play valid cards. Always include chosen_color for wild cards."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    max_tokens: 100,
    temperature: 0.1
  });

  return JSON.parse(response.choices[0].message.content);
}

function getSimpleAIDecision(hand, topCard) {
  const playableCards = getPlayableCards(hand, topCard);
  
  if (playableCards.length === 0) {
    console.log(`AI has no playable cards, drawing`);
    return { action: "draw_card" };
  }
  
  // Sort by points (highest first) for optimal strategy
  const sortedCards = playableCards.sort((a, b) => getCardPoints(b) - getCardPoints(a));
  
  console.log(`AI playable cards by priority:`, sortedCards.map(c => `${c.color} ${c.value} (${getCardPoints(c)}pts)`));
  
  const bestCard = sortedCards[0];
  let chosenColor = null;
  
  // Smart color selection for wild cards
  if (bestCard.value === "wild" || bestCard.value === "draw4") {
    chosenColor = getBestColorForHand(hand);
    console.log(`AI playing wild card, optimal color choice: ${chosenColor}`);
    console.log(`Color analysis:`, getColorAnalysis(hand));
  }
  
  console.log(`AI final decision: ${bestCard.color} ${bestCard.value} (${getCardPoints(bestCard)}pts)${chosenColor ? ` -> ${chosenColor}` : ''}`);
  
  return {
    action: "play_card",
    card: bestCard,
    chosen_color: chosenColor
  };
}

function getPlayableCards(hand, topCard) {
  return hand.filter(card => {
    // Wild cards can always be played
    if (card.value === "wild") return true;
    
    // Draw 4 can only be played if no cards match top card's color
    if (card.value === "draw4") {
      const hasMatchingColor = hand.some(c => c.color === topCard.color);
      return !hasMatchingColor;
    }
    
    // Regular cards: must match color or value
    return card.color === topCard.color || card.value === topCard.value;
  });
}

function getBestColorForHand(hand) {
  const analysis = getColorAnalysis(hand);
  
  // Strategy: Choose color with highest total point value (not just count)
  let bestColor = 'red';
  let bestScore = 0;
  
  for (const [color, data] of Object.entries(analysis)) {
    // Weight: (count * 2) + total points - prioritizes both quantity and high-value cards
    const score = (data.count * 2) + data.totalPoints;
    if (score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }
  
  console.log(`Best color choice: ${bestColor} (score: ${bestScore})`);
  return bestColor;
}

function getColorAnalysis(hand) {
  const analysis = {
    red: { count: 0, totalPoints: 0, cards: [] },
    blue: { count: 0, totalPoints: 0, cards: [] },
    green: { count: 0, totalPoints: 0, cards: [] },
    yellow: { count: 0, totalPoints: 0, cards: [] }
  };
  
  hand.forEach(card => {
    if (analysis[card.color]) {
      analysis[card.color].count++;
      analysis[card.color].totalPoints += getCardPoints(card);
      analysis[card.color].cards.push(`${card.value}`);
    }
  });
  
  return analysis;
}

function isValidAIDecision(decision, hand, topCard) {
  if (!decision || !decision.action) return false;
  
  if (decision.action === "draw_card") {
    // Only valid if no playable cards exist
    const playableCards = getPlayableCards(hand, topCard);
    return playableCards.length === 0;
  }
  
  if (decision.action === "play_card") {
    if (!decision.card) return false;
    
    const card = decision.card;
    
    // Check if player actually has this card
    const hasCard = hand.some(c => {
      if (card.value === "wild" || card.value === "draw4") {
        return c.value === card.value;
      }
      return c.color === card.color && c.value === card.value;
    });
    
    if (!hasCard) {
      console.log(`AI tried to play card it doesn't have: ${card.color} ${card.value}`);
      return false;
    }
    
    // Check if card is actually playable
    const playableCards = getPlayableCards(hand, topCard);
    const isPlayable = playableCards.some(c => {
      if (card.value === "wild" || card.value === "draw4") {
        return c.value === card.value;
      }
      return c.color === card.color && c.value === card.value;
    });
    
    if (!isPlayable) {
      console.log(`AI tried to play unplayable card: ${card.color} ${card.value} on ${topCard.color} ${topCard.value}`);
      return false;
    }
    
    // Validate wild card color selection
    if ((card.value === "wild" || card.value === "draw4") && !decision.chosen_color) {
      console.log(`AI played wild card without choosing color`);
      return false;
    }
    
    return true;
  }
  
  return false;
}

function getCardPoints(card) {
  if (card.value === "wild" || card.value === "draw4") return 50;
  if (card.value === "skip" || card.value === "reverse" || card.value === "draw2") return 20;
  const n = Number(card.value);
  return Number.isFinite(n) ? n : 0;
}

// Enhanced execute function with better validation
async function executeAIDecision(roomId, aiPlayerId, decision) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  // Double-validate the decision
  const aiHand = room.handsById[aiPlayerId] || [];
  if (!isValidAIDecision(decision, aiHand, room.topCard)) {
    console.error(`AI decision failed validation, using fallback`);
    executeAIFallback(roomId, aiPlayerId);
    return;
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  
  console.log(`AI ${aiPlayerId} executing validated decision:`, decision);
  
  switch (decision.action) {
    case "play_card":
      if (decision.card) {
        const shouldCallUno = aiHand.length === 2;
        
        let cardToPlay = { ...decision.card };
        
        if (cardToPlay.value === "wild" || cardToPlay.value === "draw4") {
          if (decision.chosen_color) {
            cardToPlay.color = decision.chosen_color;
            console.log(`AI set wild card color to: ${decision.chosen_color}`);
          } else {
            const fallbackColor = getBestColorForHand(aiHand);
            cardToPlay.color = fallbackColor;
            console.log(`AI fallback color selection: ${fallbackColor}`);
          }
        }
        
        executeAICardPlay(roomId, aiPlayerId, cardToPlay, shouldCallUno);
      }
      break;
      
    case "draw_card":
      executeAIDrawCard(roomId, aiPlayerId);
      break;
  }
}

function executeAICardPlay(roomId, aiPlayerId, card, callUno = false) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const aiHand = room.handsById[aiPlayerId] || [];
  
  if (!isPlayable(card, room.topCard)) {
    console.error(`AI tried to play invalid card: ${card.color} ${card.value}`);
    executeAIFallback(roomId, aiPlayerId);
    return;
  }
  
  const hasCard = aiHand.some(c => 
    (c.color === card.color && c.value === card.value) ||
    (card.value === "wild" || card.value === "draw4") && c.value === card.value
  );
  
  if (!hasCard) {
    console.error(`AI doesn't have card: ${card.color} ${card.value}`);
    executeAIFallback(roomId, aiPlayerId);
    return;
  }
  
  settlePendingUnoBeforeAction(roomId);
  
  function sameCard(a, b) {
    if (b.value === "wild" || b.value === "draw4") return a.value === b.value;
    return a.color === b.color && a.value === b.value;
  }
  
  const cardIndex = aiHand.findIndex(c => sameCard(c, card));
  if (cardIndex !== -1) {
    room.handsById[aiPlayerId].splice(cardIndex, 1);
  }
  
  room.topCard = card;
  room.lastActivity = new Date();
  const remaining = (room.handsById[aiPlayerId]?.length ?? 0);
  
  if (remaining === 0) {
    io.to(roomId).emit("update-hands", room.handsById);
    io.to(roomId).emit("card-played", { 
      card, 
      playerId: aiPlayerId, 
      nextPlayerId: null, 
      topCard: room.topCard 
    });
    endRound(roomId, aiPlayerId);
    return;
  }
  
  if (remaining === 1) {
    if (callUno) {
      io.to(roomId).emit("uno-result", { playerId: aiPlayerId, ok: true, penalty: 0 });
    } else {
      room.unoPendingFor = aiPlayerId;
      io.to(roomId).emit("uno-window", { playerId: aiPlayerId });
      setTimeout(() => {
        if (room.unoPendingFor === aiPlayerId) {
          room.unoPendingFor = null;
          giveCards(roomId, aiPlayerId, 2);
          io.to(roomId).emit("uno-result", { playerId: aiPlayerId, ok: false, penalty: 2 });
        }
      }, 3000);
    }
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
    playerId: aiPlayerId,
    nextPlayerId: room.players[room.currentTurnIndex]?.id || null,
    topCard: room.topCard,
  });
  io.to(roomId).emit("update-hands", room.handsById);
  
  const nextPlayer = room.players[room.currentTurnIndex];
  if (nextPlayer && aiPlayers.has(nextPlayer.id)) {
    setTimeout(() => makeAIMove(roomId, nextPlayer.id), 1500);
  }
}

// Enhanced draw logic with better decision making
function executeAIDrawCard(roomId, aiPlayerId) {
  const room = rooms.get(roomId);
  if (!room || room.deck.length === 0) return;
  
  const drawn = room.deck.shift();
  if (!drawn) return;
  
  (room.handsById[aiPlayerId] ||= []).push(drawn);
  room.lastActivity = new Date();
  
  const drawnPoints = getCardPoints(drawn);
  console.log(`AI ${aiPlayerId} drew: ${drawn.color} ${drawn.value} (${drawnPoints}pts)`);
  
  // Check if the drawn card can be played
  const currentHand = room.handsById[aiPlayerId];
  const playableDrawn = getPlayableCards([drawn], room.topCard);
  
  if (playableDrawn.length > 0) {
    console.log(`AI can play drawn card immediately`);
    
    setTimeout(() => {
      // Make strategic decision about whether to play the drawn card
      const allPlayable = getPlayableCards(currentHand, room.topCard);
      const bestOption = allPlayable.sort((a, b) => getCardPoints(b) - getCardPoints(a))[0];
      
      // Play the drawn card if it's the highest point option
      if (bestOption && bestOption.color === drawn.color && bestOption.value === drawn.value) {
        console.log(`AI playing drawn card as optimal choice`);
        
        let cardToPlay = { ...drawn };
        if (drawn.value === "wild" || drawn.value === "draw4") {
          cardToPlay.color = getBestColorForHand(currentHand);
        }
        
        executeAICardPlay(roomId, aiPlayerId, cardToPlay, currentHand.length === 2);
      } else {
        console.log(`AI has better options than drawn card, passing turn`);
        advanceTurn(roomId, 1);
        io.to(roomId).emit("turn-changed", room.players[room.currentTurnIndex]?.id || null);
        io.to(roomId).emit("update-hands", room.handsById);
        
        const nextPlayer = room.players[room.currentTurnIndex];
        if (nextPlayer && aiPlayers.has(nextPlayer.id)) {
          setTimeout(() => makeAIMove(roomId, nextPlayer.id), 1500);
        }
      }
    }, 1000 + Math.random() * 1000);
    
  } else {
    console.log(`AI cannot play drawn card: ${drawn.color} ${drawn.value}`);
    advanceTurn(roomId, 1);
    io.to(roomId).emit("turn-changed", room.players[room.currentTurnIndex]?.id || null);
    io.to(roomId).emit("update-hands", room.handsById);
    
    const nextPlayer = room.players[room.currentTurnIndex];
    if (nextPlayer && aiPlayers.has(nextPlayer.id)) {
      setTimeout(() => makeAIMove(roomId, nextPlayer.id), 1500);
    }
  }
}

function executeAIFallback(roomId, aiPlayerId) {
  console.log(`AI ${aiPlayerId} falling back to draw card`);
  executeAIDrawCard(roomId, aiPlayerId);
}

// -------- Room Management --------
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(hostId, customRoomId = null, allowAI = false) {
  const roomId = customRoomId || generateRoomId();
  
  if (rooms.has(roomId)) {
    return { success: false, error: 'Room already exists' };
  }
  
  const roomData = createRoomData();
  roomData.id = roomId;
  roomData.host = hostId;
  roomData.allowAI = allowAI;
  
  rooms.set(roomId, roomData);
  console.log(`Room ${roomId} created by ${hostId} (Family: ${allowAI})`);
  
  return { success: true, roomId, roomData };
}

function addAIToRoom(roomId, difficulty = 'medium') {
  const room = rooms.get(roomId);
  if (!room || !room.allowAI) {
    return { success: false, error: 'Room does not allow family members' };
  }
  
  if (room.players.length >= room.maxPlayers) {
    return { success: false, error: 'Room is full (max 4 players)' };
  }
  
  // Check if we already have 3 family members (max allowed)
  const currentFamilyCount = room.players.filter(p => p.isAI).length;
  if (currentFamilyCount >= 3) {
    return { success: false, error: 'Maximum family members already added' };
  }
  
  const aiPlayer = createAIPlayer(difficulty);
  room.players.push({ id: aiPlayer.id, name: aiPlayer.name, isAI: true });
  room.scores[aiPlayer.id] = 0;
  room.lastActivity = new Date();
  
  console.log(`Family member ${aiPlayer.name} joined room ${roomId}`);
  return { success: true, aiPlayer, room };
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
    return { success: false, error: 'Room is full (max 4 players)' };
  }
  
  if (room.players.some(p => p.id === playerId)) {
    return { success: false, error: 'Already in room' };
  }
  
  room.players.push({ id: playerId, name: playerName });
  room.scores[playerId] = 0;
  room.lastActivity = new Date();
  
  playerRooms.set(playerId, roomId);
  
  console.log(`Player ${playerName} (${playerId}) joined room ${roomId}`);
  return { success: true, room };
}

function leaveRoom(playerId) {
  const roomId = playerRooms.get(playerId);
  if (!roomId) return { success: false, error: 'Not in a room' };
  
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'Room not found' };
  
  room.players = room.players.filter(p => p.id !== playerId);
  delete room.handsById[playerId];
  delete room.scores[playerId];
  
  if (aiPlayers.has(playerId)) {
    // Reset family name index when family member leaves so names can be reused
    const leavingAI = aiPlayers.get(playerId);
    console.log(`Family member ${leavingAI.name} left room ${roomId}`);
    removeAIPlayer(playerId);
    
    // Reset index to allow reuse of names
    const remainingFamilyCount = room.players.filter(p => p.isAI).length;
    if (remainingFamilyCount === 0) {
      familyNameIndex = 0; // Reset when no family members left
    }
  }
  
  if (room.unoPendingFor === playerId) {
    room.unoPendingFor = null;
  }
  
  if (room.players.length > 0 && room.currentTurnIndex >= room.players.length) {
    room.currentTurnIndex = 0;
  }
  
  playerRooms.delete(playerId);
  
  if (room.host === playerId && room.players.length > 0) {
    const newHost = room.players.find(p => !p.isAI) || room.players[0];
    room.host = newHost.id;
  }
  
  if (room.players.length === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted - empty`);
    // Reset family name index when room is deleted
    familyNameIndex = 0;
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
        allowAI: room.allowAI,
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

// -------- Game Helper Functions --------
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
    if (!aiPlayers.has(playerId)) {
      io.to(playerId).emit("card-drawn", d);
    }
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
  
  const firstPlayer = room.players[room.currentTurnIndex];
  if (firstPlayer && aiPlayers.has(firstPlayer.id)) {
    setTimeout(() => makeAIMove(roomId, firstPlayer.id), 2000);
  }
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
      if (aiPlayers.has(p.id)) {
        removeAIPlayer(p.id);
      }
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
    
    setTimeout(() => {
      if (rooms.has(roomId) && room.status === 'finished') {
        rooms.delete(roomId);
        console.log(`Room ${roomId} auto-deleted - finished`);
      }
    }, 300000);
    
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

// -------- Deck Creation --------
function createDeck() {
  const colors = ["red", "blue", "green", "yellow"];
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "skip", "reverse", "draw2"];
  const deck = [];

  // Number and action cards
  colors.forEach(color => {
    values.forEach(value => {
      deck.push({ color, value });
      if (value !== 0) {
        deck.push({ color, value }); // Two of each except 0
      }
    });
  });

  // Wild cards
  for (let i = 0; i < 4; i++) {
    deck.push({ color: "wild", value: "wild" });
    deck.push({ color: "wild", value: "draw4" });
  }

  return deck;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealHands(players, deck) {
  const hands = {};
  players.forEach(player => {
    hands[player.id] = deck.splice(0, 7);
  });
  return hands;
}

// -------- Socket Events --------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("create-room", ({ roomId, playerName, allowAI = false }) => {
    const result = createRoom(socket.id, roomId, allowAI);
    
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
  
  socket.on("add-ai-player", ({ difficulty = 'medium' }) => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.host !== socket.id) {
      return socket.emit("room-error", { message: "Only host can add family members" });
    }
    
    const result = addAIToRoom(roomId, difficulty);
    
    if (result.success) {
      io.to(roomId).emit("room-updated", result.room);
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

  socket.on("start-game", () => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.host !== socket.id) return;
    if (room.players.length === 0) return;
    
    room.scores = {};
    room.players.forEach((p) => (room.scores[p.id] = 0));
    room.gameOver = false;
    room.status = 'active';
    
    startRound(roomId);
  });

  // NEW: Target score selection handler
  socket.on("set-target-score", (targetScore) => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.host !== socket.id) {
      return socket.emit("room-error", { message: "Only host can change target score" });
    }
    
    if (room.status === 'active') {
      return socket.emit("room-error", { message: "Cannot change target score during game" });
    }
    
    const allowedScores = [100, 300, 500];
    if (!allowedScores.includes(Number(targetScore))) {
      return socket.emit("room-error", { message: "Invalid target score" });
    }
    
    room.targetScore = Number(targetScore);
    room.lastActivity = new Date();
    
    console.log(`Target score changed to ${targetScore} in room ${roomId}`);
    
    // Notify all players in the room
    io.to(roomId).emit("scores-updated", { 
      scores: room.scores, 
      targetScore: room.targetScore 
    });
    
    // Also update the room data
    io.to(roomId).emit("room-updated", room);
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
    const current = room.players[room.currentTurnIndex];
    
    if (!current || current.id !== me) {
      return socket.emit("invalid-play", { message: "Not your turn." });
    }

    const myHand = room.handsById[me] || [];
    
    // Validate card exists in hand
    function sameCard(a, b) {
      if (b.value === "wild" || b.value === "draw4") return a.value === b.value;
      return a.color === b.color && a.value === b.value;
    }
    
    const cardIndex = myHand.findIndex(c => sameCard(c, card));
    if (cardIndex === -1) {
      return socket.emit("invalid-play", { message: "You don't have that card." });
    }

    // Validate play is legal
    if (!isPlayable(card, room.topCard)) {
      return socket.emit("invalid-play", { message: "Card cannot be played." });
    }

    // Special validation for Draw 4
    if (card.value === "draw4") {
      const hasMatchingColor = hasColorInHand(myHand, room.topCard.color);
      if (hasMatchingColor) {
        return socket.emit("invalid-play", { message: "Cannot play Draw 4 when you have matching color." });
      }
    }

    // Remove card from hand
    myHand.splice(cardIndex, 1);
    room.topCard = card;
    room.lastActivity = new Date();

    const remaining = myHand.length;

    // Check for game end
    if (remaining === 0) {
      io.to(roomId).emit("update-hands", room.handsById);
      io.to(roomId).emit("card-played", { 
        card, 
        playerId: me, 
        nextPlayerId: null, 
        topCard: room.topCard 
      });
      endRound(roomId, me);
      return;
    }

    // Handle UNO declaration
    if (remaining === 1) {
      if (unoDeclared) {
        io.to(roomId).emit("uno-result", { playerId: me, ok: true, penalty: 0 });
      } else {
        room.unoPendingFor = me;
        io.to(roomId).emit("uno-window", { playerId: me });
        setTimeout(() => {
          if (room.unoPendingFor === me) {
            room.unoPendingFor = null;
            giveCards(roomId, me, 2);
            io.to(roomId).emit("uno-result", { playerId: me, ok: false, penalty: 2 });
          }
        }, 3000);
      }
    }

    // Handle special card effects
    switch (card.value) {
      case "skip":
        advanceTurn(roomId, 2);
        break;
      case "reverse":
        room.direction *= -1;
        if (room.players.length !== 2) {
          advanceTurn(roomId, 1);
        }
        break;
      case "draw2": {
        const nextIdx = mod(room.currentTurnIndex + room.direction, room.players.length);
        const nextId = room.players[nextIdx].id;
        giveCards(roomId, nextId, 2);
        advanceTurn(roomId, 2);
        break;
      }
      case "draw4": {
        const nextIdx = mod(room.currentTurnIndex + room.direction, room.players.length);
        const nextId = room.players[nextIdx].id;
        giveCards(roomId, nextId, 4);
        advanceTurn(roomId, 2);
        break;
      }
      default:
        advanceTurn(roomId, 1);
    }

    // Emit updates
    io.to(roomId).emit("card-played", {
      card,
      playerId: me,
      nextPlayerId: room.players[room.currentTurnIndex]?.id || null,
      topCard: room.topCard,
    });
    io.to(roomId).emit("update-hands", room.handsById);

    // Trigger AI move if next player is AI
    const nextPlayer = room.players[room.currentTurnIndex];
    if (nextPlayer && aiPlayers.has(nextPlayer.id)) {
      setTimeout(() => makeAIMove(roomId, nextPlayer.id), 1500);
    }
  });

  // Enhanced draw-card handler with play-after-draw feature
  socket.on("draw-card", () => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.gameOver || room.status !== 'active') return;

    settlePendingUnoBeforeAction(roomId);

    const me = socket.id;
    const current = room.players[room.currentTurnIndex];
    
    if (!current || current.id !== me) {
      return socket.emit("invalid-play", { message: "Not your turn." });
    }

    if (room.deck.length === 0) {
      return socket.emit("invalid-play", { message: "Deck is empty." });
    }

    const drawn = room.deck.shift();
    (room.handsById[me] ||= []).push(drawn);
    room.lastActivity = new Date();

    // Check if the drawn card can be played immediately
    let canPlayDrawn = isPlayable(drawn, room.topCard);
    
    // Special case for Draw 4 - check if player has matching color
    if (drawn.value === "draw4" && canPlayDrawn) {
      const hasMatchingColor = hasColorInHand(room.handsById[me], room.topCard.color);
      if (hasMatchingColor) {
        canPlayDrawn = false;
      }
    }
    
    if (canPlayDrawn) {
      // Offer the option to play the drawn card
      socket.emit("card-drawn", { 
        card: drawn, 
        canPlay: true,
        message: "You drew a playable card! You may play it immediately or pass your turn."
      });
    } else {
      // Card cannot be played, turn ends automatically
      socket.emit("card-drawn", { card: drawn, canPlay: false });
      advanceTurn(roomId, 1);
      io.to(roomId).emit("turn-changed", room.players[room.currentTurnIndex]?.id || null);
      io.to(roomId).emit("update-hands", room.handsById);
      
      // Trigger AI move if next player is AI
      const nextPlayer = room.players[room.currentTurnIndex];
      if (nextPlayer && aiPlayers.has(nextPlayer.id)) {
        setTimeout(() => makeAIMove(roomId, nextPlayer.id), 1500);
      }
    }
  });

  // New socket event for passing turn after drawing
  socket.on("pass-turn", () => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!room || room.gameOver || room.status !== 'active') return;
    
    const me = socket.id;
    const current = room.players[room.currentTurnIndex];
    
    if (!current || current.id !== me) return;
    
    advanceTurn(roomId, 1);
    io.to(roomId).emit("turn-changed", room.players[room.currentTurnIndex]?.id || null);
    io.to(roomId).emit("update-hands", room.handsById);
    
    // Trigger AI move if next player is AI
    const nextPlayer = room.players[room.currentTurnIndex];
    if (nextPlayer && aiPlayers.has(nextPlayer.id)) {
      setTimeout(() => makeAIMove(roomId, nextPlayer.id), 1500);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    leaveRoom(socket.id);
  });
});

// -------- Server Startup --------
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`UNO Server running on port ${PORT}`);
  console.log(`Family features: ${!!process.env.OPENAI_API_KEY && !!openai ? 'enabled' : 'disabled'}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});