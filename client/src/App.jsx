// ===== client/src/App.jsx =====
import React, { useState, useEffect, useMemo } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Socket.IO client - connects to production server or localhost
const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
  transports: ["websocket"],
  reconnectionAttempts: 5,
});

// Remove exactly ONE instance of a played card from a hand.
// For wild/draw4 we match by value only (ignore chosen color on the played card).
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
  const [name, setName] = useState("");
  const [nameSubmitted, setNameSubmitted] = useState(false);

  const [players, setPlayers] = useState([]);
  const [hand, setHand] = useState([]);
  const [allHands, setAllHands] = useState({});
  const [gameStarted, setGameStarted] = useState(false);

  const [topCard, setTopCard] = useState(null);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);

  const [pendingWildCard, setPendingWildCard] = useState(null);
  const [colorMessage, setColorMessage] = useState("");

  // UNO flow UI
  const [unoPendingFor, setUnoPendingFor] = useState(null); // socket id who must press UNO now
  const [unoBanner, setUnoBanner] = useState(null);         // { text, ok, playerId }
  const [unoPressed, setUnoPressed] = useState(false);

  // Scoreboard / round summary / tournament winner
  const [scores, setScores] = useState({});
  const [targetScore, setTargetScore] = useState(500);
  const [roundSummary, setRoundSummary] = useState(null);   // { winnerId, breakdown[], eliminatedIds[] }
  const [winner, setWinner] = useState(null);               // { playerId, name }

  // ---------- Socket wiring ----------
  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("update-players", setPlayers);
    socket.on("invalid-play", ({ message }) => alert(message));

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

      // Update counts for *all* hands (remove exactly ONE matching card)
      setAllHands(prev => {
        const updated = { ...prev };
        if (updated[playerId]) updated[playerId] = removeOneCard(updated[playerId], card);
        return updated;
      });

      // Update *my* hand removal (remove exactly ONE)
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

    // --- UNO flow ---
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

    // Round summary + scores
    socket.on("round-ended", ({ winnerId, scores: sc, breakdown, eliminatedIds, targetScore: ts }) => {
      setScores(sc || {});
      setTargetScore(ts || 500);
      setRoundSummary({ winnerId, breakdown, eliminatedIds });
    });

    // Tournament winner
    socket.on("tournament-won", ({ championId, championName, scores: sc }) => {
      setScores(sc || {});
      setWinner({ playerId: championId, name: championName || "Winner" });
      setUnoPendingFor(null);
    });

    // Optional live score updates / hand mirrors
    socket.on("scores-updated", ({ scores: sc, targetScore: ts }) => {
      if (sc) setScores(sc);
      if (ts) setTargetScore(ts);
    });
    socket.on("update-hands", (hands) => {
      setAllHands(hands);
      setHand(hands[socket.id] || []);
    });

    return () => {
      socket.off("connect");
      socket.off("update-players");
      socket.off("invalid-play");
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
    };
  }, [players]);

  // ---------- Helpers ----------
  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    socket.emit("new-player", name.trim());
    setNameSubmitted(true);
  };

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

  // Seat mapping relative to the local player
  const positions = ["player-bottom", "player-top", "player-right", "player-left"];
  const orderedPlayers = useMemo(() => {
    const idx = players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return players;
    return players.map((_, i) => players[(idx + i) % players.length]);
  }, [players]);

  const myUnoActive = unoPendingFor === socket.id && hand.length === 1;

  return (
    <div className="container">
      {/* Small inline styles for UNO button / banners / winner / round summary / scoreboard */}
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
          background:rgba(0,0,0,.55);
          z-index: 1600;
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
      `}</style>

      {!connected && <h2>Connecting…</h2>}

      {connected && !nameSubmitted && (
        <form onSubmit={handleNameSubmit}>
          <h2>Enter Name</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your Name"
          />
          <button className="button">Join</button>
        </form>
      )}

      {connected && nameSubmitted && !gameStarted && !winner && (
        <div>
          <h2>Lobby</h2>
          <ul>
            {players.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
          <button className="button" onClick={() => socket.emit("start-game")}>
            Start Game
          </button>
        </div>
      )}

      {gameStarted && (
        <div className="game-area">
          {/* Scoreboard */}
          <div className="scoreboard">
            <div className="title">Scores (to {targetScore})</div>
            {players.map(p => (
              <div key={p.id}>{p.name}: {scores[p.id] ?? 0}</div>
            ))}
          </div>

          {colorMessage && <div className="color-message">{colorMessage}</div>}

          {/* UNO banners (auto hides in 3s) */}
          {unoBanner && (
            <div className={`uno-banner ${unoBanner.ok ? "ok" : "fail"}`}>
              {unoBanner.text}
            </div>
          )}

          {/* Round summary (shown between rounds) */}
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

          {/* Tournament winner overlay */}
          {winner && (
            <div className="overlay">
              <div className="box" style={{ fontSize: 34 }}>
                {winner.name} wins the tournament!
              </div>
            </div>
          )}

          {/* Piles */}
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

          {/* Players around the table */}
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

          {/* Wild / Draw4 color picker */}
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

          {/* UNO button (only active while you're the pending UNO player and you have 1 card) */}
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