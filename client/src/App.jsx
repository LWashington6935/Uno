import React, { useState, useEffect, useMemo } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Environment-aware connection logic
const getApiUrl = () => {
  // Check for environment variables (Vite uses VITE_ prefix)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // Check for production environment
  if (import.meta.env.PROD) {
    // Your actual Render backend URL
    return 'https://uno-game-server-saq7.onrender.com';
  }
  
  // Development fallback
  return 'http://localhost:3001';
};

const API_URL = getApiUrl();

// Initialize socket with environment-aware URL
const socket = io(API_URL, {
  transports: ["websocket", "polling"],
  upgrade: true,
  rememberUpgrade: false,
  timeout: 20000,
  forceNew: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
  maxReconnectionAttempts: 5
});

function removeOneCard(hand = [], played) {
  let removed = false;
  return hand.filter((c) => {
    if (removed) return true;
    const isWildish = played.value === "wild" || played.value === "draw4";
    const match = isWildish
      ? c.value === played.value
      : c.color === played.color && c.value === played.value;
    if (match) {
      removed = true;
      return false;
    }
    return true;
  });
}

function App() {
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [name, setName] = useState("");
  const [appState, setAppState] = useState('name');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [roomError, setRoomError] = useState('');
  const [createRoomId, setCreateRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [allowAI, setAllowAI] = useState(false);
  const [players, setPlayers] = useState([]);
  const [hand, setHand] = useState([]);
  const [allHands, setAllHands] = useState({});
  const [gameStarted, setGameStarted] = useState(false);
  const [topCard, setTopCard] = useState(null);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [pendingWildCard, setPendingWildCard] = useState(null);
  const [colorMessage, setColorMessage] = useState("");
  const [unoPendingFor, setUnoPendingFor] = useState(null);
  const [unoBanner, setUnoBanner] = useState(null);
  const [unoPressed, setUnoPressed] = useState(false);
  const [scores, setScores] = useState({});
  const [targetScore, setTargetScore] = useState(500);
  const [roundSummary, setRoundSummary] = useState(null);
  const [winner, setWinner] = useState(null);
  const [drawnCard, setDrawnCard] = useState(null);
  const [canPlayDrawn, setCanPlayDrawn] = useState(false);

  const hasPlayableCard = () => {
    if (canPlayDrawn && drawnCard) {
      console.log("hasPlayableCard: true (can play drawn card)");
      return true;
    }
    
    if (!topCard) {
      console.log("hasPlayableCard: false (no top card)");
      return false;
    }
    
    let effectiveTopCard = { ...topCard };
    
    if ((effectiveTopCard.value === "wild" || effectiveTopCard.value === "draw4") && 
        (!effectiveTopCard.color || effectiveTopCard.color === "wild")) {
      console.warn("Wild card without proper color detected:", effectiveTopCard);
      console.log("hasPlayableCard: false (wild card without color - allowing draw)");
      return false;
    }
    
    const playableCards = hand.filter((c) => {
      if (c.color === effectiveTopCard.color || c.value === effectiveTopCard.value) {
        return true;
      }
      
      if (c.value === "wild") {
        return true;
      }
      
      if (c.value === "draw4") {
        const hasMatchingColor = hand.some(card => 
          card.color === effectiveTopCard.color && 
          card.value !== "wild" && 
          card.value !== "draw4"
        );
        return !hasMatchingColor;
      }
      
      return false;
    });
    
    const result = playableCards.length > 0;
    console.log("=== hasPlayableCard analysis ===");
    console.log("- Hand:", hand.map(c => `${c.color} ${c.value}`));
    console.log("- Raw top card:", topCard);
    console.log("- Effective top card:", effectiveTopCard);
    console.log("- Playable cards:", playableCards.map(c => `${c.color} ${c.value}`));
    console.log("- Can play drawn?", canPlayDrawn);
    console.log("- Drawn card:", drawnCard);
    console.log("- Final result:", result);
    console.log("================================");
    
    return result;
  };

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Connected to server:", socket.id, "at", API_URL);
      setConnected(true);
      setConnectionError('');
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
      setConnected(false);
      setConnectionError(`Connection failed: ${error.message}`);
    });

    socket.on("disconnect", (reason) => {
      console.log("Disconnected from server:", reason);
      setConnected(false);
      if (reason === "io server disconnect") {
        socket.connect();
      }
    });

    socket.on("reconnect", (attemptNumber) => {
      console.log("Reconnected after", attemptNumber, "attempts");
      setConnected(true);
      setConnectionError('');
    });

    socket.on("reconnect_error", (error) => {
      console.error("Reconnection failed:", error);
      setConnectionError(`Reconnection failed: ${error.message}`);
    });

    socket.on("reconnect_failed", () => {
      console.error("Reconnection failed - giving up");
      setConnectionError("Failed to reconnect to server. Please refresh the page.");
    });

    socket.on("room-created", ({ roomId, room }) => {
      console.log("Room created:", roomId);
      setCurrentRoom(room);
      setAppState('room');
      setRoomError('');
    });

    socket.on("room-joined", ({ roomId, room }) => {
      console.log("Room joined:", roomId);
      setCurrentRoom(room);
      setAppState('room');
      setRoomError('');
    });

    socket.on("room-updated", (room) => {
      console.log("Room updated:", room);
      setCurrentRoom(room);
      setPlayers(room.players);
    });

    socket.on("room-left", () => {
      console.log("Left room");
      setCurrentRoom(null);
      setAppState('lobby');
      setGameStarted(false);
      setWinner(null);
      setRoundSummary(null);
    });

    socket.on("room-error", ({ message }) => {
      console.error("Room error:", message);
      setRoomError(message);
    });

    socket.on("rooms-list", (rooms) => {
      console.log("Rooms list received:", rooms.length, "rooms");
      setAvailableRooms(rooms);
    });

    socket.on("game-started", ({ hands, topCard: initialTop, currentPlayerId, scores: sc, targetScore: ts }) => {
      console.log("Game started");
      setGameStarted(true);
      setHand(hands[socket.id] || []);
      setAllHands(hands);
      setTopCard(initialTop);
      setCurrentPlayerId(currentPlayerId ?? null);
      setColorMessage("");
      setPendingWildCard(null);
      setUnoPendingFor(null);
      setUnoBanner(null);
      setWinner(null);
      setRoundSummary(null);
      setScores(sc || {});
      setTargetScore(ts || 500);
      setDrawnCard(null);
      setCanPlayDrawn(false);
    });

    socket.on("card-played", ({ card, playerId, nextPlayerId, topCard }) => {
      console.log("=== Card played event ===");
      console.log("Card played:", card, "by", playerId);
      console.log("Next player:", nextPlayerId);
      console.log("New top card from server:", topCard);
      
      let finalTopCard = { ...topCard };
      if ((card.value === "wild" || card.value === "draw4") && card.color && card.color !== "wild") {
        finalTopCard.color = card.color;
        console.log("Corrected wild card color:", finalTopCard);
      }
      
      setTopCard(finalTopCard);
      setCurrentPlayerId(nextPlayerId ?? null);
      setDrawnCard(null);
      setCanPlayDrawn(false);
      console.log("Reset drawn card state after card played");

      if (card.value === "wild") {
        setColorMessage(`Color selected: ${card.color?.toUpperCase?.() || ""}`);
      } else if (card.value === "draw4") {
        setColorMessage(
          `Color selected: ${card.color?.toUpperCase?.() || ""}. Next player draws 4 and is skipped!`
        );
      } else {
        setColorMessage("");
      }

      setAllHands(prev => {
        const updated = { ...prev };
        if (updated[playerId]) updated[playerId] = removeOneCard(updated[playerId], card);
        return updated;
      });

      if (playerId === socket.id) setHand(prev => removeOneCard(prev, card));
      setPendingWildCard(null);
      
      console.log("=========================");
    });

    socket.on("card-drawn", (data) => {
      const card = data.card || data;
      const canPlay = data.canPlay || false;
      const message = data.message || "";
      
      console.log("Card drawn:", card, "canPlay:", canPlay);
      
      setHand(prev => [...prev, card]);
      setAllHands(prev => ({
        ...prev,
        [socket.id]: [...(prev[socket.id] || []), card],
      }));
      
      if (canPlay) {
        setDrawnCard(card);
        setCanPlayDrawn(true);
        if (message) {
          console.log(message);
        }
      } else {
        setDrawnCard(null);
        setCanPlayDrawn(false);
      }
    });

    socket.on("turn-changed", (id) => {
      console.log("Turn changed to:", id);
      setCurrentPlayerId(id ?? null);
      setColorMessage("");
      setPendingWildCard(null);
      
      if (id !== socket.id) {
        setDrawnCard(null);
        setCanPlayDrawn(false);
        console.log("Reset drawn card state - not my turn");
      }
    });

    socket.on("uno-window", ({ playerId }) => {
      console.log("UNO window for:", playerId);
      setUnoPendingFor(playerId);
    });

    socket.on("uno-result", ({ playerId, ok, penalty }) => {
      const p = players.find(x => x.id === playerId);
      const who = p ? p.name : "Player";
      console.log("UNO result:", who, ok ? "success" : "failed");
      setUnoBanner({
        text: ok ? `${who} called UNO!` : `${who} missed UNO! +${penalty}`,
        ok,
        playerId,
      });
      setUnoPendingFor(prev => (prev === playerId ? null : prev));
      setTimeout(() => setUnoBanner(null), 3000);
    });

    socket.on("round-ended", ({ winnerId, scores: sc, breakdown, eliminatedIds, targetScore: ts }) => {
      console.log("Round ended, winner:", winnerId);
      setScores(sc || {});
      setTargetScore(ts || 500);
      setRoundSummary({ winnerId, breakdown, eliminatedIds });
    });

    socket.on("tournament-won", ({ championId, championName, scores: sc }) => {
      console.log("Tournament won by:", championName);
      setScores(sc || {});
      setWinner({ playerId: championId, name: championName || "Winner" });
      setUnoPendingFor(null);
    });

    socket.on("scores-updated", ({ scores: sc, targetScore: ts }) => {
      console.log("Scores updated");
      if (sc) setScores(sc);
      if (ts) setTargetScore(ts);
    });

    socket.on("update-hands", (hands) => {
      console.log("Hands updated");
      setAllHands(hands);
      setHand(hands[socket.id] || []);
    });

    socket.on("invalid-play", ({ message }) => {
      console.error("Invalid play:", message);
      alert(message);
    });

    return () => {
      console.log("Cleaning up socket listeners");
      socket.off("connect");
      socket.off("connect_error");
      socket.off("disconnect");
      socket.off("reconnect");
      socket.off("reconnect_error");
      socket.off("reconnect_failed");
      socket.off("room-created");
      socket.off("room-joined");
      socket.off("room-updated");
      socket.off("room-left");
      socket.off("room-error");
      socket.off("rooms-list");
      socket.off("game-started");
      socket.off("card-played");
      socket.off("card-drawn");
      socket.off("turn-changed");
      socket.off("uno-window");
      socket.off("uno-result");
      socket.off("round-ended");
      socket.off("tournament-won");
      socket.off("scores-updated");
      socket.off("update-hands");
      socket.off("invalid-play");
    };
  }, [players, socket.id]);

  useEffect(() => {
    if (appState === 'lobby' && connected) {
      console.log("Requesting rooms list");
      socket.emit("get-rooms");
      const interval = setInterval(() => {
        if (connected) {
          socket.emit("get-rooms");
        }
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [appState, connected]);

  useEffect(() => {
    window.debugUNO = {
      resetDrawnState: () => {
        setDrawnCard(null);
        setCanPlayDrawn(false);
        console.log("Manually reset drawn card state");
      },
      
      logCurrentState: () => {
        console.log("=== CURRENT GAME STATE ===");
        console.log("API URL:", API_URL);
        console.log("Connected:", connected);
        console.log("Current Player ID:", currentPlayerId);
        console.log("My Socket ID:", socket.id);
        console.log("Is my turn:", currentPlayerId === socket.id);
        console.log("Hand:", hand);
        console.log("Top Card:", topCard);
        console.log("Can Play Drawn:", canPlayDrawn);
        console.log("Drawn Card:", drawnCard);
        console.log("Has Playable:", hasPlayableCard());
        console.log("=========================");
      },
      
      forceAllowDraw: () => {
        setCanPlayDrawn(false);
        setDrawnCard(null);
        console.log("EMERGENCY: Forced draw state reset");
      }
    };
    
    return () => {
      delete window.debugUNO;
    };
  }, [currentPlayerId, socket.id, hand, topCard, canPlayDrawn, drawnCard, hasPlayableCard, connected]);

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!connected) {
      alert("Not connected to server. Please wait or refresh the page.");
      return;
    }
    setAppState('lobby');
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!connected) {
      alert("Not connected to server. Please wait or refresh the page.");
      return;
    }
    console.log("Creating room");
    socket.emit("create-room", { 
      roomId: createRoomId.trim() || undefined, 
      playerName: name,
      allowAI: allowAI
    });
  };

  const handleJoinRoom = (roomId) => {
    if (!connected) {
      alert("Not connected to server. Please wait or refresh the page.");
      return;
    }
    console.log("Joining room:", roomId);
    socket.emit("join-room", { roomId, playerName: name });
  };

  const handleLeaveRoom = () => {
    if (!connected) return;
    console.log("Leaving room");
    socket.emit("leave-room");
  };

  const handleStartGame = () => {
    if (!connected) return;
    console.log("Starting game");
    socket.emit("start-game");
  };

  const handleAddAI = (difficulty) => {
    if (!connected) return;
    console.log("Adding family member:", difficulty);
    socket.emit("add-ai-player", { difficulty });
  };

  const handleTargetScoreChange = (newScore) => {
    if (!connected) return;
    console.log("Setting target score:", newScore);
    socket.emit("set-target-score", newScore);
  };

  const handleDrawCard = () => {
    if (currentPlayerId !== socket.id) {
      console.log("Cannot draw: not your turn");
      return;
    }
    
    if (!connected) {
      console.log("Cannot draw: not connected");
      return;
    }
    
    if (canPlayDrawn) {
      console.log("Cannot draw: still in play-drawn state");
      return;
    }
    
    const hasPlayable = hasPlayableCard();
    
    if (hasPlayable) {
      console.log("Cannot draw: you have playable cards");
      alert("You still have a playable card!");
      return;
    }
    
    console.log("Drawing card - no playable cards available");
    socket.emit("draw-card");
  };

  const handlePassTurn = () => {
    if (!connected) return;
    console.log("Passing turn and clearing drawn card state");
    socket.emit("pass-turn");
    setDrawnCard(null);
    setCanPlayDrawn(false);
  };

  const handleCardClick = (card) => {
    if (currentPlayerId !== socket.id) return;
    if (!connected) return;
    
    console.log("Playing card:", card);
    
    if (canPlayDrawn && drawnCard && 
        card.color === drawnCard.color && 
        card.value === drawnCard.value) {
      
      if (card.value === "wild" || card.value === "draw4") {
        setPendingWildCard(card);
      } else {
        socket.emit("play-card", { card });
        setDrawnCard(null);
        setCanPlayDrawn(false);
      }
      return;
    }
    
    if (card.value === "wild" || card.value === "draw4") {
      setPendingWildCard(card);
    } else {
      socket.emit("play-card", { card });
    }
  };

  // [Rest of your existing component code - renderBackFan, renderHandFan, handleWildColor, etc.]
  // [I'm keeping the rest of the file exactly as you had it to preserve all your game logic]

  const renderBackFan = (count) => {
    if (count === 0) return null;
    
    const maxVisibleCards = 12;
    const visibleCount = Math.min(count, maxVisibleCards);
    const cardSpacing = count > 8 ? -25 : count > 5 ? -20 : -15;
    const cardScale = count > 10 ? 0.8 : count > 6 ? 0.9 : 1;
    
    return (
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {Array(visibleCount).fill().map((_, i) => {
          const angle = visibleCount > 1 ? 
            -15 + (30 * i) / (visibleCount - 1) : 0;
          
          return (
            <img
              key={i}
              src="/cards/back.jpg"
              alt="back"
              className="card-img disabled"
              style={{
                transform: `rotate(${angle}deg) scale(${cardScale})`,
                marginLeft: i === 0 ? 0 : `${cardSpacing}px`,
                zIndex: i,
              }}
              onError={(e) => {
                e.target.style.background = '#333';
                e.target.style.color = '#fff';
                e.target.innerHTML = 'CARD';
              }}
            />
          );
        })}
        {count > maxVisibleCards && (
          <div 
            style={{
              position: 'absolute',
              top: '50%',
              right: '-20px',
              transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.8)',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 'bold'
            }}
          >
            +{count - maxVisibleCards}
          </div>
        )}
      </div>
    );
  };

  const renderHandFan = () => {
    const count = hand.length;
    if (count === 0) return null;
    
    const maxVisibleCards = 15;
    const visibleCards = hand.slice(0, maxVisibleCards);
    const hiddenCards = Math.max(0, count - maxVisibleCards);
    
    const getCardSpacing = () => {
      const screenWidth = window.innerWidth;
      if (screenWidth < 480) {
        return count > 10 ? -30 : count > 7 ? -25 : -20;
      } else if (screenWidth < 768) {
        return count > 12 ? -25 : count > 8 ? -20 : -15;
      } else {
        return count > 15 ? -20 : count > 10 ? -15 : -10;
      }
    };
    
    const cardSpacing = getCardSpacing();
    const maxSpread = window.innerWidth < 480 ? 30 : 40;
    const cardScale = count > 12 ? 0.85 : count > 8 ? 0.92 : 1;
    
    return (
      <div style={{ 
        position: 'relative', 
        display: 'flex', 
        justifyContent: 'center',
        alignItems: 'center',
        flexWrap: 'nowrap',
        overflow: 'visible'
      }}>
        {visibleCards.map((card, i) => {
          const angle = visibleCards.length > 1 ? 
            -maxSpread / 2 + (maxSpread * i) / (visibleCards.length - 1) : 0;
          const fname = `${card.color}_${card.value}`.toLowerCase();
          
          const isDrawnCard = canPlayDrawn && drawnCard && 
                             card.color === drawnCard.color && 
                             card.value === drawnCard.value;
          
          return (
            <img
              key={i}
              src={`/cards/${fname}.jpg`}
              alt="card"
              className="card-img"
              style={{ 
                transform: `rotate(${angle}deg) scale(${cardScale})`,
                marginLeft: i === 0 ? 0 : `${cardSpacing}px`,
                zIndex: i,
                cursor: currentPlayerId === socket.id ? 'pointer' : 'default',
                transition: 'transform 0.2s ease',
                border: isDrawnCard ? '3px solid #ffdf00' : 'none',
                boxShadow: isDrawnCard ? '0 0 15px rgba(255, 223, 0, 0.8)' : 'none'
              }}
              onClick={() => handleCardClick(card)}
              onMouseEnter={(e) => {
                if (currentPlayerId === socket.id) {
                  e.target.style.transform = `rotate(${angle}deg) scale(${cardScale * 1.05}) translateY(-10px)`;
                  e.target.style.zIndex = 999;
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = `rotate(${angle}deg) scale(${cardScale})`;
                e.target.style.zIndex = i;
              }}
              onError={(e) => {
                e.target.style.background = card.color === 'wild' ? '#333' : card.color;
                e.target.style.color = '#fff';
                e.target.innerHTML = card.value;
                e.target.style.display = 'flex';
                e.target.style.alignItems = 'center';
                e.target.style.justifyContent = 'center';
                e.target.style.fontSize = '10px';
                e.target.style.fontWeight = 'bold';
              }}
            />
          );
        })}
        
        {hiddenCards > 0 && (
          <div 
            style={{
              position: 'absolute',
              top: '-10px',
              right: '-15px',
              background: 'rgba(255, 215, 0, 0.9)',
              color: '#000',
              padding: '4px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 'bold',
              border: '2px solid #fff',
              zIndex: 1000
            }}
          >
            +{hiddenCards}
          </div>
        )}
      </div>
    );
  };

  const handleWildColor = (color) => {
    if (!connected) return;
    
    console.log("Selected wild color:", color);
    setColorMessage(
      `Color selected: ${color.toUpperCase()}` +
        (pendingWildCard.value === "draw4"
          ? ". Next player draws 4 and is skipped!"
          : "")
    );
    const played = { ...pendingWildCard, color };
    socket.emit("play-card", { card: played });
    setPendingWildCard(null);
    
    if (canPlayDrawn && drawnCard && 
        drawnCard.value === pendingWildCard.value) {
      setDrawnCard(null);
      setCanPlayDrawn(false);
    }
  };

  const orderedPlayers = useMemo(() => {
    if (players.length === 0) return [];
    
    const myIndex = players.findIndex((p) => p.id === socket.id);
    if (myIndex < 0) return players;
    
    const reordered = [];
    for (let i = 0; i < players.length; i++) {
      const playerIndex = (myIndex + i) % players.length;
      reordered.push(players[playerIndex]);
    }
    
    return reordered;
  }, [players, socket.id]);

  const myUnoActive = unoPendingFor === socket.id && hand.length === 1;
  const isHost = currentRoom?.host === socket.id;

  return (
    <div className="container">
      <style>{`
        .connection-status {
          position: fixed;
          top: 10px;
          left: 10px;
          padding: 8px 12px;
          border-radius: 5px;
          font-size: 12px;
          font-weight: bold;
          z-index: 10000;
        }
        .connected {
          background: rgba(0, 255, 0, 0.2);
          color: #00ff00;
          border: 1px solid #00ff00;
        }
        .disconnected {
          background: rgba(255, 0, 0, 0.2);
          color: #ff0000;
          border: 1px solid #ff0000;
        }
        .uno-btn {
          background:#ffdf00; color:#000; border:none; border-radius:999px;
          padding:12px 20px; font-weight:900; letter-spacing:1px; cursor:pointer;
          transition:transform .06s ease;
        }
        .uno-btn:disabled { 
          opacity:.5; 
          cursor:not-allowed; 
        }
        .uno-banner {
          position:absolute; top:12%; left:50%; transform:translateX(-50%);
          font-size:48px; font-weight:900; padding:.4rem 1rem; border-radius:10px;
          background:rgba(0,0,0,.55); z-index: 1600;
        }
        .uno-banner.ok { 
          color:#00ff95; 
          text-shadow:0 0 16px rgba(0,255,149,.8); 
        }
        .uno-banner.fail { 
          color:#ff6262; 
          text-shadow:0 0 16px rgba(255,98,98,.8); 
        }
        .overlay {
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          background:rgba(0,0,0,.45); z-index:2000;
        }
        .box {
          padding:1rem 1.5rem; border-radius:12px; background:#111a; color:#fff;
          font-size:28px; font-weight:800; text-shadow:0 0 18px rgba(255,255,255,.5);
          max-width:600px;
        }
        .scoreboard {
          position:absolute; top:8px; left:8px;
          background:rgba(0,0,0,.35); padding:8px 12px; border-radius:8px; z-index:1400;
          font-size:14px;
        }
        .scoreboard .title { 
          font-weight:700; 
          margin-bottom:4px; 
        }
        .room-info {
          position:absolute; top:8px; right:8px;
          background:rgba(0,0,0,.35); padding:8px 12px; border-radius:8px; z-index:1400;
          font-size:14px; text-align:right;
        }
        .lobby-container {
          display: flex; flex-direction: column; align-items: center; gap: 2rem;
          max-width: 800px; margin: 0 auto; padding: 2rem;
        }
        .rooms-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem; width: 100%;
        }
        .room-card {
          background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 8px;
          border: 2px solid transparent; cursor: pointer; transition: all 0.2s;
        }
        .room-card:hover {
          border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.15);
        }
        .room-lobby {
          display: flex; flex-direction: column; align-items: center; gap: 1rem;
          max-width: 600px; margin: 0 auto; padding: 2rem;
        }
        .family-player {
          color: #00ff95;
          font-weight: bold;
        }
        .family-controls {
          background: rgba(255,215,0,0.1); 
          border: 2px solid rgba(255,215,0,0.3);
          padding: 1rem; 
          border-radius: 8px; 
          margin: 1rem 0;
        }
        .family-badge {
          display: inline-block;
          background: rgba(255,215,0,0.8);
          color: #000;
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: bold;
          margin-left: 5px;
        }
        .family-thinking {
          opacity: 0.7;
          font-style: italic;
        }
        .checkbox-container {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 10px 0;
        }
        .family-dropdown {
          padding: 8px;
          border-radius: 5px;
          border: none;
          margin-right: 10px;
          background: white;
          color: black;
        }
        .score-controls {
          background: rgba(0, 123, 255, 0.1);
          border: 2px solid rgba(0, 123, 255, 0.3);
          padding: 1rem;
          border-radius: 8px;
          margin: 1rem 0;
        }
        .score-selector {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
        }
        .score-option {
          padding: 8px 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          background: rgba(255, 255, 255, 0.1);
          color: white;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s;
          font-weight: bold;
        }
        .score-option:hover {
          background: rgba(255, 255, 255, 0.2);
          border-color: rgba(255, 255, 255, 0.5);
        }
        .score-option.active {
          background: rgba(0, 123, 255, 0.8);
          border-color: #007bff;
          color: white;
        }
        .player-zone {
          position: absolute;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 10px;
          border-radius: 8px;
          transition: all 0.3s ease;
        }
        .player-bottom {
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
        }
        .player-top {
          top: 80px;
          left: 50%;
          transform: translateX(-50%);
        }
        .player-right {
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
        }
        .player-left {
          left: 20px;
          top: 50%;
          transform: translateY(-50%);
        }
        .current-turn {
          background: rgba(255, 215, 0, 0.1);
          border: 2px solid rgba(255, 215, 0, 0.5);
          animation: pulse 2s infinite;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.6);
        }
        .card-img {
          width: 60px;
          height: 90px;
          border-radius: 8px;
          object-fit: cover;
        }
        .card-img:hover {
          filter: brightness(1.1);
        }
        .button {
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          background: #007bff;
          color: white;
          cursor: pointer;
          font-size: 14px;
        }
        .button:disabled {
          background: #666;
          cursor: not-allowed;
        }
        .game-area {
          position: relative;
          height: 100vh;
          width: 100vw;
        }
        .piles {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          gap: 20px;
          align-items: center;
        }
        .draw-pile, .top-card-pile {
          position: relative;
        }
        .draw-pile:not(.disabled) {
          cursor: pointer;
        }
        .draw-pile.disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .color-picker {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          padding: 20px;
          border-radius: 10px;
          z-index: 2500;
          text-align: center;
          color: white;
        }
        .color-picker h3 {
          margin-top: 0;
          color: #ffdf00;
        }
        .color-picker button {
          margin: 5px;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          color: white;
          font-weight: bold;
          cursor: pointer;
          min-width: 80px;
        }
        .color-message {
          position: absolute;
          top: 20%;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.7);
          padding: 10px 20px;
          border-radius: 5px;
          color: white;
          font-weight: bold;
          z-index: 1500;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        @media (max-width: 480px) {
          .player-zone {
            padding: 5px;
            gap: 4px;
          }
          .card-img {
            max-width: 40px;
            max-height: 60px;
          }
          .player-hand {
            max-width: 90vw;
            overflow: hidden;
          }
        }
        @media (max-width: 768px) {
          .card-img {
            max-width: 45px;
            max-height: 67px;
          }
        }
      `}</style>

      <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
        {connected ? `Connected (${API_URL})` : 'Disconnected'}
      </div>

      {connectionError && !connected && (
        <div style={{
          position: 'fixed',
          top: '50px',
          left: '10px',
          right: '10px',
          background: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid #ff0000',
          color: '#ff0000',
          padding: '10px',
          borderRadius: '5px',
          fontSize: '14px',
          zIndex: 10000
        }}>
          {connectionError}
          <br />
          <small>Trying to connect to: {API_URL}</small>
          <button 
            onClick={() => window.location.reload()} 
            style={{ marginLeft: '10px', padding: '5px 10px' }}
          >
            Refresh Page
          </button>
        </div>
      )}

      {!connected && <h2>Connecting to server...</h2>}

      {/* Rest of your existing render logic unchanged */}
      {connected && appState === 'name' && (
        <form onSubmit={handleNameSubmit} className="lobby-container">
          <h1>UNO Family Tournament</h1>
          <div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter Your Name"
              style={{ padding: '12px', fontSize: '16px', marginRight: '10px', borderRadius: '5px', border: 'none' }}
            />
            <button className="button" type="submit">Continue</button>
          </div>
        </form>
      )}

      {connected && appState === 'lobby' && (
        <div className="lobby-container">
          <h1>UNO Family Rooms</h1>
          <p>Welcome, {name}!</p>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '10px', width: '100%', maxWidth: '400px' }}>
            <h3>Create New Room</h3>
            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                value={createRoomId}
                onChange={(e) => setCreateRoomId(e.target.value.toUpperCase())}
                placeholder="Custom Room ID (optional)"
                maxLength={6}
                style={{ padding: '10px', borderRadius: '5px', border: 'none' }}
              />
              <div className="checkbox-container">
                <input
                  type="checkbox"
                  id="allowAI"
                  checked={allowAI}
                  onChange={(e) => setAllowAI(e.target.checked)}
                />
                <label htmlFor="allowAI">Allow A.I. Family Members </label>
              </div>
              <button className="button" type="submit">Create Room</button>
            </form>
          </div>

          <div style={{ width: '100%' }}>
            <h3>Available Rooms ({availableRooms.length})</h3>
            {availableRooms.length === 0 ? (
              <p style={{ textAlign: 'center', opacity: 0.7 }}>No rooms available. Create one!</p>
            ) : (
              <div className="rooms-grid">
                {availableRooms.map((room) => (
                  <div
                    key={room.id}
                    className="room-card"
                    onClick={() => handleJoinRoom(room.id)}
                  >
                    <div style={{ fontWeight: 'bold', fontSize: '18px' }}>
                      {room.id}
                      {room.allowAI && <span className="family-badge">FAMILY</span>}
                    </div>
                    <div>Host: {room.host}</div>
                    <div>Players: {room.playerCount}/4</div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>
                      Created: {new Date(room.created).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '10px', width: '100%', maxWidth: '400px' }}>
            <h3>Join by Room ID</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                placeholder="Enter Room ID"
                maxLength={6}
                style={{ padding: '10px', borderRadius: '5px', border: 'none', flex: 1 }}
              />
              <button 
                className="button" 
                onClick={() => handleJoinRoom(joinRoomId)}
                disabled={!joinRoomId.trim()}
              >
                Join
              </button>
            </div>
          </div>

          {roomError && (
            <div style={{ color: '#ff6262', textAlign: 'center', fontWeight: 'bold' }}>
              {roomError}
            </div>
          )}
        </div>
      )}

      {connected && appState === 'room' && !gameStarted && !winner && (
        <div className="room-lobby">
          <h2>
            Room: {currentRoom?.id}
            {currentRoom?.allowAI && <span className="family-badge">FAMILY ENABLED</span>}
          </h2>
          <p>Status: {currentRoom?.status === 'waiting' ? 'Waiting for players' : 'Game in progress'}</p>
          
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', minWidth: '300px' }}>
            <h3>Players ({players.length}/4)</h3>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {players.map((p) => (
                <li key={p.id} style={{ padding: '5px 0' }}>
                  <span className={p.isAI ? 'family-player' : ''}>
                    {p.name}
                    {p.isAI && <span className="family-badge">FAMILY</span>}
                  </span>
                  {p.id === currentRoom?.host && ' (Host)'}
                  {p.id === socket.id && ' (You)'}
                </li>
              ))}
            </ul>
          </div>

          {isHost && !gameStarted && (
            <div className="score-controls">
              <h4>Game Settings</h4>
              <p style={{ fontSize: '14px', opacity: 0.8, margin: '0 0 10px 0' }}>
                Choose target score to win the tournament
              </p>
              <div className="score-selector">
                {[100, 300, 500].map((score) => (
                  <div
                    key={score}
                    className={`score-option ${targetScore === score ? 'active' : ''}`}
                    onClick={() => handleTargetScoreChange(score)}
                  >
                    {score} Points
                  </div>
                ))}
              </div>
            </div>
          )}

          {isHost && currentRoom?.allowAI && (
            <div className="family-controls">
              <h4>Family Members</h4>
              <p style={{ fontSize: '14px', opacity: 0.8 }}>Invite family to join the game</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <select className="family-dropdown" id="family-difficulty">
                  <option value="easy">Easy Player</option>
                  <option value="medium">Normal Player</option>
                  <option value="hard">Skilled Player</option>
                </select>
                <button 
                  className="button"
                  onClick={() => {
                    const difficulty = document.getElementById('family-difficulty').value;
                    handleAddAI(difficulty);
                  }}
                  disabled={players.length >= 4}
                  style={{ background: '#ffdf00', color: '#000' }}
                >
                  Add Family Member
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            {isHost && (
              <button 
                className="button" 
                onClick={handleStartGame}
                disabled={players.length < 2}
              >
                Start Game
              </button>
            )}
            <button 
              className="button" 
              onClick={handleLeaveRoom}
              style={{ background: '#666' }}
            >
              Leave Room
            </button>
          </div>
        </div>
      )}

      {gameStarted && currentRoom && (
        <div className="game-area">
          <div className="room-info">
            <div>Room: {currentRoom.id}</div>
            <div>Players: {players.length}/4</div>
            {currentRoom.allowAI && <div style={{ color: '#ffdf00' }}>Family Game</div>}
          </div>

          <div className="scoreboard">
            <div className="title">Scores (to {targetScore})</div>
            {players.map(p => (
              <div key={p.id} className={p.isAI ? 'family-player' : ''}>
                {p.name}: {scores[p.id] ?? 0}
                {p.isAI && <span className="family-badge">FAMILY</span>}
              </div>
            ))}
          </div>

          {colorMessage && <div className="color-message">{colorMessage}</div>}

          {unoBanner && (
            <div className={`uno-banner ${unoBanner.ok ? "ok" : "fail"}`}>
              {unoBanner.text}
            </div>
          )}

          {roundSummary && (
            <div className="overlay">
              <div className="box">
                <div style={{ fontSize: 22, marginBottom: 8 }}>
                  Round winner: {players.find(x=>x.id===roundSummary.winnerId)?.name || "Player"}
                </div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>Penalty points added:</div>
                <ul style={{ margin: 0, paddingLeft: 18, textAlign: "left" }}>
                  {roundSummary.breakdown.map(row => (
                    <li key={row.playerId}>
                      {row.name}: +{row.added} (total {row.total})
                      {roundSummary.eliminatedIds?.includes(row.playerId) ? " — ELIMINATED" : ""}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 10, fontSize: 13, opacity: .85 }}>
                  Next round starts automatically…
                </div>
              </div>
            </div>
          )}

          {winner && (
            <div className="overlay">
              <div className="box" style={{ fontSize: 34 }}>
                {winner.name} wins the tournament!
                <div style={{ fontSize: 18, marginTop: 10 }}>
                  <button className="button" onClick={handleLeaveRoom}>
                    Leave Room
                  </button>
                </div>
              </div>
            </div>
          )}

          {canPlayDrawn && drawnCard && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0, 0, 0, 0.9)',
              padding: '20px',
              borderRadius: '10px',
              border: '2px solid #ffdf00',
              zIndex: 2500,
              textAlign: 'center',
              color: 'white'
            }}>
              <h3 style={{ marginTop: 0, color: '#ffdf00' }}>Card Drawn!</h3>
              <p>You drew a playable card:</p>
              
              <div style={{ margin: '15px 0' }}>
                <img
                  src={`/cards/${drawnCard.color}_${drawnCard.value}.jpg`}
                  alt="drawn card"
                  className="card-img"
                  style={{ 
                    cursor: 'pointer',
                    border: '2px solid #ffdf00',
                    borderRadius: '8px'
                  }}
                  onClick={() => handleCardClick(drawnCard)}
                  onError={(e) => {
                    e.target.style.background = drawnCard.color === 'wild' ? '#333' : drawnCard.color;
                    e.target.style.color = '#fff';
                    e.target.innerHTML = drawnCard.value;
                    e.target.style.display = 'flex';
                    e.target.style.alignItems = 'center';
                    e.target.style.justifyContent = 'center';
                    e.target.style.fontSize = '12px';
                    e.target.style.fontWeight = 'bold';
                  }}
                />
              </div>
              
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button
                  className="button"
                  onClick={() => handleCardClick(drawnCard)}
                  style={{ background: '#28a745', border: 'none' }}
                >
                  Play This Card
                </button>
                <button
                  className="button"
                  onClick={handlePassTurn}
                  style={{ background: '#6c757d', border: 'none' }}
                >
                  Pass Turn
                </button>
              </div>
            </div>
          )}

          <div className="piles">
            <div
              className={`draw-pile${
                currentPlayerId !== socket.id || 
                hasPlayableCard() || 
                canPlayDrawn ? " disabled" : ""
              }`}
              onClick={handleDrawCard}
              title={
                currentPlayerId !== socket.id 
                  ? "Not your turn" 
                  : hasPlayableCard() 
                    ? "You have playable cards" 
                    : canPlayDrawn 
                      ? "Play or pass your drawn card first"
                      : "Draw a card"
              }
            >
              <img 
                src="/cards/back.jpg" 
                alt="Draw Deck" 
                className="card-img"
                onError={(e) => {
                  e.target.style.background = '#333';
                  e.target.style.color = '#fff';
                  e.target.innerHTML = 'DRAW';
                  e.target.style.display = 'flex';
                  e.target.style.alignItems = 'center';
                  e.target.style.justifyContent = 'center';
                  e.target.style.fontSize = '12px';
                  e.target.style.fontWeight = 'bold';
                }}
              />
            </div>

            <div className="top-card-pile">
              {topCard && (
                <img
                  src={`/cards/${topCard.color}_${topCard.value}.jpg`}
                  alt="top"
                  className="card-img"
                  onError={(e) => {
                    e.target.style.background = topCard.color === 'wild' ? '#333' : topCard.color;
                    e.target.style.color = '#fff';
                    e.target.innerHTML = topCard.value;
                    e.target.style.display = 'flex';
                    e.target.style.alignItems = 'center';
                    e.target.style.justifyContent = 'center';
                    e.target.style.fontSize = '12px';
                    e.target.style.fontWeight = 'bold';
                  }}
                />
              )}
            </div>
          </div>

          {orderedPlayers.map((player, i) => {
            let position;
            const totalPlayers = orderedPlayers.length;
            
            if (totalPlayers === 2) {
              position = i === 0 ? "player-bottom" : "player-top";
            } else if (totalPlayers === 3) {
              const positions = ["player-bottom", "player-right", "player-left"];
              position = positions[i];
            } else if (totalPlayers === 4) {
              const positions = ["player-bottom", "player-right", "player-top", "player-left"];
              position = positions[i];
            } else {
              const positions = ["player-bottom", "player-right", "player-top", "player-left"];
              position = positions[i % 4];
            }
            
            const count = allHands[player.id]?.length || 0;
            const isSelf = player.id === socket.id;
            const isTurn = player.id === currentPlayerId;
            const isFamily = player.isAI;
            
            return (
              <div 
                className={`player-zone ${position} ${isTurn ? "current-turn" : ""}`} 
                key={player.id}
              >
                <div className={isFamily ? 'family-player' : ''}>
                  {player.name}
                  {isFamily && <span className="family-badge">FAMILY</span>}
                  {isFamily && isTurn && <span className="family-thinking"> (thinking...)</span>}
                  {isTurn && !isFamily && <span style={{color: '#ffdf00'}}> ← YOUR TURN</span>}
                  <div style={{fontSize: '12px', opacity: 0.8}}>
                    {count} card{count !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="player-hand">
                  {isSelf ? renderHandFan() : renderBackFan(count)}
                </div>
              </div>
            );
          })}

          {pendingWildCard && (
            <div className="color-picker">
              <h3>Choose Color</h3>
              {["red", "blue", "green", "yellow"].map((color) => (
                <button
                  key={color}
                  onClick={() => handleWildColor(color)}
                  style={{ backgroundColor: color }}
                >
                  {color.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <div style={{ position: "absolute", bottom: 12, right: 12 }}>
            <button
              className="uno-btn"
              disabled={!myUnoActive}
              style={{
                transform: unoPressed ? "scale(0.96)" : "scale(1)",
                boxShadow: myUnoActive ? "0 0 18px rgba(255,223,0,.9)" : "0 2px 10px rgba(0,0,0,.35)"
              }}
              onMouseDown={() => setUnoPressed(true)}
              onMouseUp={() => setUnoPressed(false)}
              onMouseLeave={() => setUnoPressed(false)}
              onClick={() => {
                if (!connected) return;
                console.log("Declaring UNO");
                socket.emit("declare-uno");
              }}
              title="Call UNO now"
            >
              UNO
            </button>
          </div>
        </div>
      )}

      {/* Debug info in development */}
      {import.meta.env.DEV && (
        <div style={{
          position: 'fixed',
          bottom: '10px',
          right: '10px',
          background: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '10px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '12px',
          maxWidth: '300px',
          zIndex: 10000
        }}>
          <div>API: {API_URL}</div>
          <div>Connected: {connected ? 'Yes' : 'No'}</div>
          <div>Socket ID: {socket.id}</div>
        </div>
      )}
    </div>
  );
}

export default App;