// ===== client/src/App.jsx =====
import React, { useState, useEffect, useMemo } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
  transports: ["polling", "websocket"],
  upgrade: true,
  rememberUpgrade: false
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
  // Connection state
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState("");
  
  // App state flow: 'name' -> 'lobby' -> 'room' -> 'game'
  const [appState, setAppState] = useState('name');
  
  // Room state
  const [currentRoom, setCurrentRoom] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [roomError, setRoomError] = useState('');
  const [createRoomId, setCreateRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  
  // Game state (same as before)
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

  useEffect(() => {
    // Connection events
    socket.on("connect", () => {
      console.log("Connected!");
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected");
      setConnected(false);
      setAppState('name');
      setCurrentRoom(null);
    });

    // Room management events
    socket.on("room-created", ({ roomId, room }) => {
      setCurrentRoom(room);
      setAppState('room');
      setRoomError('');
    });

    socket.on("room-joined", ({ roomId, room }) => {
      setCurrentRoom(room);
      setAppState('room');
      setRoomError('');
    });

    socket.on("room-updated", (room) => {
      setCurrentRoom(room);
      setPlayers(room.players);
    });

    socket.on("room-left", () => {
      setCurrentRoom(null);
      setAppState('lobby');
      setGameStarted(false);
      setWinner(null);
      setRoundSummary(null);
    });

    socket.on("room-error", ({ message }) => {
      setRoomError(message);
    });

    socket.on("rooms-list", (rooms) => {
      setAvailableRooms(rooms);
    });

    // Game events (same as before)
    socket.on("game-started", ({ hands, topCard: initialTop, currentPlayerId, scores: sc, targetScore: ts }) => {
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
    });

    socket.on("card-played", ({ card, playerId, nextPlayerId, topCard }) => {
      setTopCard(topCard);
      setCurrentPlayerId(nextPlayerId ?? null);

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
    });

    socket.on("card-drawn", (card) => {
      setHand(prev => [...prev, card]);
      setAllHands(prev => ({
        ...prev,
        [socket.id]: [...(prev[socket.id] || []), card],
      }));
    });

    socket.on("turn-changed", (id) => {
      setCurrentPlayerId(id ?? null);
      setColorMessage("");
      setPendingWildCard(null);
    });

    socket.on("uno-window", ({ playerId }) => {
      setUnoPendingFor(playerId);
    });

    socket.on("uno-result", ({ playerId, ok, penalty }) => {
      const p = players.find(x => x.id === playerId);
      const who = p ? p.name : "Player";
      setUnoBanner({
        text: ok ? `${who} called UNO!` : `${who} missed UNO! +${penalty}`,
        ok,
        playerId,
      });
      setUnoPendingFor(prev => (prev === playerId ? null : prev));
      setTimeout(() => setUnoBanner(null), 3000);
    });

    socket.on("round-ended", ({ winnerId, scores: sc, breakdown, eliminatedIds, targetScore: ts }) => {
      setScores(sc || {});
      setTargetScore(ts || 500);
      setRoundSummary({ winnerId, breakdown, eliminatedIds });
    });

    socket.on("tournament-won", ({ championId, championName, scores: sc }) => {
      setScores(sc || {});
      setWinner({ playerId: championId, name: championName || "Winner" });
      setUnoPendingFor(null);
    });

    socket.on("scores-updated", ({ scores: sc, targetScore: ts }) => {
      if (sc) setScores(sc);
      if (ts) setTargetScore(ts);
    });

    socket.on("update-hands", (hands) => {
      setAllHands(hands);
      setHand(hands[socket.id] || []);
    });

    socket.on("invalid-play", ({ message }) => alert(message));

    return () => {
      socket.off("connect");
      socket.off("disconnect");
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
  }, [players]);

  // Refresh room list when in lobby
  useEffect(() => {
    if (appState === 'lobby') {
      socket.emit("get-rooms");
      const interval = setInterval(() => {
        socket.emit("get-rooms");
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [appState]);

  // Event handlers
  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAppState('lobby');
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    socket.emit("create-room", { 
      roomId: createRoomId.trim() || undefined, 
      playerName: name 
    });
  };

  const handleJoinRoom = (roomId) => {
    socket.emit("join-room", { roomId, playerName: name });
  };

  const handleLeaveRoom = () => {
    socket.emit("leave-room");
  };

  const handleStartGame = () => {
    socket.emit("start-game");
  };

  // Game handlers (same as before)
  const hasPlayableCard = () =>
    hand.some(
      (c) =>
        c.color === topCard?.color ||
        c.value === topCard?.value ||
        c.value === "wild"
    );

  const handleDrawCard = () => {
    if (currentPlayerId !== socket.id) return;
    if (hasPlayableCard()) {
      alert("You still have a playable card!");
      return;
    }
    socket.emit("draw-card");
  };

  const renderBackFan = (count) => {
    const spread = 20;
    return Array(count)
      .fill()
      .map((_, i) => {
        const angle = count > 1 ? -spread / 2 + (spread * i) / (count - 1) : 0;
        return (
          <img
            key={i}
            src="/cards/back.jpg"
            alt="back"
            className="card-img disabled"
            style={{
              transform: `rotate(${angle}deg)`,
              margin: "-20px",
            }}
          />
        );
      });
  };

  const renderHandFan = () => {
    const count = hand.length;
    const spread = 40;
    return hand.map((card, i) => {
      const angle = count > 1 ? -spread / 2 + (spread * i) / (count - 1) : 0;
      const fname = `${card.color}_${card.value}`.toLowerCase();
      return (
        <img
          key={i}
          src={`/cards/${fname}.jpg`}
          alt="card"
          className="card-img"
          style={{ transform: `rotate(${angle}deg)`, margin: "-10px" }}
          onClick={() => {
            if (currentPlayerId !== socket.id) return;
            if (card.value === "wild" || card.value === "draw4") {
              setPendingWildCard(card);
            } else {
              socket.emit("play-card", { card });
            }
          }}
        />
      );
    });
  };

  const handleWildColor = (color) => {
    setColorMessage(
      `Color selected: ${color.toUpperCase()}` +
        (pendingWildCard.value === "draw4"
          ? ". Next player draws 4 and is skipped!"
          : "")
    );
    const played = { ...pendingWildCard, color };
    socket.emit("play-card", { card: played });
    setPendingWildCard(null);
  };

  // Player positioning
  const positions = ["player-bottom", "player-top", "player-right", "player-left"];
  const orderedPlayers = useMemo(() => {
    const idx = players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return players;
    return players.map((_, i) => players[(idx + i) % players.length]);
  }, [players]);

  const myUnoActive = unoPendingFor === socket.id && hand.length === 1;
  const isHost = currentRoom?.host === socket.id;

  // Render different screens based on app state
  return (
    <div className="container">
      <style>{`
        .uno-btn {
          background:#ffdf00; color:#000; border:none; border-radius:999px;
          padding:12px 20px; font-weight:900; letter-spacing:1px; cursor:pointer;
          transform:${unoPressed ? "scale(0.96)" : "scale(1)"};
          transition:transform .06s ease;
          box-shadow:${myUnoActive ? "0 0 18px rgba(255,223,0,.9)" : "0 2px 10px rgba(0,0,0,.35)"};
        }
        .uno-btn:disabled { opacity:.5; cursor:not-allowed; }

        .uno-banner {
          position:absolute; top:12%; left:50%; transform:translateX(-50%);
          font-size:48px; font-weight:900; padding:.4rem 1rem; border-radius:10px;
          background:rgba(0,0,0,.55); z-index: 1600;
        }
        .uno-banner.ok { color:#00ff95; text-shadow:0 0 16px rgba(0,255,149,.8); }
        .uno-banner.fail { color:#ff6262; text-shadow:0 0 16px rgba(255,98,98,.8); }

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
        .scoreboard .title { font-weight:700; margin-bottom:4px; }

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
      `}</style>

      {!connected && <h2>Connecting...</h2>}

      {/* Name Entry Screen */}
      {connected && appState === 'name' && (
        <form onSubmit={handleNameSubmit} className="lobby-container">
          <h1>UNO Tournament</h1>
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

      {/* Room Lobby Screen */}
      {connected && appState === 'lobby' && (
        <div className="lobby-container">
          <h1>UNO Rooms</h1>
          <p>Welcome, {name}!</p>

          {/* Create Room */}
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
              <button className="button" type="submit">Create Room</button>
            </form>
          </div>

          {/* Available Rooms */}
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
                    <div style={{ fontWeight: 'bold', fontSize: '18px' }}>{room.id}</div>
                    <div>Host: {room.host}</div>
                    <div>Players: {room.playerCount}/{room.maxPlayers}</div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>
                      Created: {new Date(room.created).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Join by ID */}
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

      {/* Room Waiting Screen */}
      {connected && appState === 'room' && !gameStarted && !winner && (
        <div className="room-lobby">
          <h2>Room: {currentRoom?.id}</h2>
          <p>Status: {currentRoom?.status === 'waiting' ? 'Waiting for players' : 'Game in progress'}</p>
          
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', minWidth: '300px' }}>
            <h3>Players ({players.length}/{currentRoom?.maxPlayers})</h3>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {players.map((p) => (
                <li key={p.id} style={{ padding: '5px 0' }}>
                  {p.name} {p.id === currentRoom?.host && '(Host)'} {p.id === socket.id && '(You)'}
                </li>
              ))}
            </ul>
          </div>

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

      {/* Game Screen */}
      {gameStarted && currentRoom && (
        <div className="game-area">
          {/* Room info */}
          <div className="room-info">
            <div>Room: {currentRoom.id}</div>
            <div>Players: {players.length}</div>
          </div>

          {/* Scoreboard */}
          <div className="scoreboard">
            <div className="title">Scores (to {targetScore})</div>
            {players.map(p => (
              <div key={p.id}>{p.name}: {scores[p.id] ?? 0}</div>
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

          <div className="piles">
            <div
              className={`draw-pile${currentPlayerId !== socket.id || hasPlayableCard() ? " disabled" : ""}`}
              onClick={handleDrawCard}
            >
              <img src="/cards/back.jpg" alt="Draw Deck" className="card-img" />
            </div>

            <div className="top-card-pile">
              {topCard && (
                <img
                  src={`/cards/${topCard.color}_${topCard.value}.jpg`}
                  alt="top"
                  className="card-img"
                />
              )}
            </div>
          </div>

          {orderedPlayers.map((player, i) => {
            const pos = positions[i] || "player-bottom";
            const count = allHands[player.id]?.length || 0;
            const isSelf = player.id === socket.id;
            const isTurn = player.id === currentPlayerId;
            return (
              <div className={`player-zone ${pos} ${isTurn ? "current-turn" : ""}`} key={player.id}>
                <div>{player.name}</div>
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
              onMouseDown={() => setUnoPressed(true)}
              onMouseUp={() => setUnoPressed(false)}
              onMouseLeave={() => setUnoPressed(false)}
              onClick={() => socket.emit("declare-uno")}
              title="Call UNO now"
            >
              UNO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;