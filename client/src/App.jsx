// ===== client/src/App.jsx =====
import React, { useState, useEffect, useMemo } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Socket.IO client
const socket = io("http://localhost:3001", {
  transports: ["websocket"],
  reconnectionAttempts: 5,
});

// Remove EXACTLY the card by its unique id (server should include `id` per card)
function removeById(hand = [], played) {
  return hand.filter((c) => c.id !== played.id);
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

  // UNO UI/flow
  const [unoPendingFor, setUnoPendingFor] = useState(null);
  const [unoBanner, setUnoBanner] = useState(null);  // { text, ok, playerId }
  const [unoPressed, setUnoPressed] = useState(false);

  // Winner popup
  const [winner, setWinner] = useState(null);        // { playerId, name }

  // ---------- Socket wiring ----------
  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("update-players", setPlayers);
    socket.on("invalid-play", ({ message }) => alert(message));

    socket.on("game-started", ({ hands, topCard: initialTop, currentPlayerId }) => {
      setGameStarted(true);
      setHand(hands[socket.id] || []);
      setAllHands(hands);
      setTopCard(initialTop);
      setCurrentPlayerId(currentPlayerId);
      setColorMessage("");
      setPendingWildCard(null);
      setUnoPendingFor(null);
      setUnoBanner(null);
      setWinner(null);
    });

    socket.on("card-played", ({ card, playerId, nextPlayerId, topCard }) => {
      setTopCard(topCard);
      setCurrentPlayerId(nextPlayerId ?? null);

      if (card.value === "wild") {
        setColorMessage(`Color selected: ${card.color.toUpperCase()}`);
      } else if (card.value === "draw4") {
        setColorMessage(
          `Color selected: ${card.color.toUpperCase()}. Next player draws 4 and is skipped!`
        );
      } else {
        setColorMessage("");
      }

      setAllHands((prev) => {
        const updated = { ...prev };
        if (updated[playerId]) updated[playerId] = removeById(updated[playerId], card);
        return updated;
      });

      if (playerId === socket.id) {
        setHand((prev) => removeById(prev, card));
      }

      setPendingWildCard(null);
    });

    socket.on("card-drawn", (card) => {
      setHand((prev) => [...prev, card]);
      setAllHands((prev) => ({
        ...prev,
        [socket.id]: [...(prev[socket.id] || []), card],
      }));
    });

    socket.on("turn-changed", (id) => {
      setCurrentPlayerId(id ?? null);
      setColorMessage("");
      setPendingWildCard(null);
    });

    // UNO flow
    socket.on("uno-window", ({ playerId }) => setUnoPendingFor(playerId));
    socket.on("uno-result", ({ playerId, ok, penalty }) => {
      const p = players.find((x) => x.id === playerId);
      const who = p ? p.name : "Player";
      setUnoBanner({
        text: ok ? `${who} called UNO!` : `${who} missed UNO! +${penalty}`,
        ok,
        playerId,
      });
      setUnoPendingFor((prev) => (prev === playerId ? null : prev));
      setTimeout(() => setUnoBanner(null), 3000);
    });

    socket.on("game-won", ({ playerId, name }) => {
      setWinner({ playerId, name });
      setUnoPendingFor(null);
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
      socket.off("game-won");
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
      (c) => c.color === topCard?.color || c.value === topCard?.value || c.value === "wild"
    );

  const handleDrawCard = () => {
    if (currentPlayerId !== socket.id) return;
    if (hasPlayableCard()) {
      alert("You still have a playable card!");
      return;
    }
    socket.emit("draw-card");
  };

  // Back-of-card *horizontal* fan (top/bottom seats)
  const renderBackFan = (count, position) => {
    const offset = position === "player-top" ? 180 : 0; // upside down for top
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
            style={{ transform: `rotate(${angle + offset}deg)`, margin: "-20px" }}
          />
        );
      });
  };

  // Back-of-card column for side seats, but EACH CARD is rotated to horizontal.
  // Left: +90deg (card face points to the right); Right: -90deg (card face points to the left).
  const renderSideBackColumn = (count, side /* "player-left" | "player-right" */) => {
    const rotateDeg = side === "player-left" ? 90 : -90;
    return Array(count)
      .fill()
      .map((_, i) => (
        <img
          key={i}
          src="/cards/back.jpg"
          alt="back"
          className="card-img disabled"
          style={{
            margin: "-28px 0",
            transform: `rotate(${rotateDeg}deg)`,
            // optional: slightly narrow the visual footprint when rotated
            width: 70,
          }}
        />
      ));
  };

  // Your own hand (bottom) in a horizontal fan
  const renderHandFan = () => {
    const count = hand.length;
    const spread = 40;
    return hand.map((card, i) => {
      const angle = count > 1 ? -spread / 2 + (spread * i) / (count - 1) : 0;
      const fname = `${card.color}_${card.value}`.toLowerCase();
      return (
        <img
          key={card.id ?? i}
          src={`/cards/${fname}.jpg`}
          alt="card"
          className="card-img"
          style={{ transform: `rotate(${angle}deg)`, margin: "-10px" }}
          onClick={() => {
            if (currentPlayerId !== socket.id) return;
            if (card.value === "wild" || card.value === "draw4") {
              setPendingWildCard(card); // preserve exact card with id
            } else {
              socket.emit("play-card", { card }); // send exact card object
            }
          }}
        />
      );
    });
  };

  // Wild/draw4 color choose (uses exact card object with id)
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

  // POV layout: me at bottom; others clockwise to top/right/left
  const positions = ["player-bottom", "player-top", "player-right", "player-left"];
  const orderedPlayers = useMemo(() => {
    const idx = players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return players;
    return players.map((_, i) => players[(idx + i) % players.length]);
  }, [players]);

  const myUnoActive = unoPendingFor === socket.id && hand.length === 1;

  return (
    <div className="container">
      {/* Small inline styles for UNO button / banners / winner */}
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
        }
        .uno-banner.ok { color:#00ff95; text-shadow:0 0 16px rgba(0,255,149,.8); }
        .uno-banner.fail { color:#ff6262; text-shadow:0 0 16px rgba(255,98,98,.8); }

        .win-overlay {
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          background:rgba(0,0,0,.45); z-index:2000;
        }
        .win-box {
          padding:1rem 1.5rem; border-radius:12px; background:#111a; color:#fff;
          font-size:42px; font-weight:900; text-shadow:0 0 18px rgba(255,255,255,.6);
        }
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

      {connected && nameSubmitted && !gameStarted && (
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
          {colorMessage && <div className="color-message">{colorMessage}</div>}

          {/* UNO banners (3s) */}
          {unoBanner && (
            <div className={`uno-banner ${unoBanner.ok ? "ok" : "fail"}`}>
              {unoBanner.text}
            </div>
          )}

          {/* Winner popup */}
          {winner && (
            <div className="win-overlay">
              <div className="win-box">{winner.name} wins the game!</div>
            </div>
          )}

          <div className="piles">
            <div
              className={`draw-pile${
                currentPlayerId !== socket.id || hasPlayableCard() ? " disabled" : ""
              }`}
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

            // When more than 2 players, sides (left/right) keep vertical layout,
            // but cards are rotated to be horizontally readable.
            const isSide = pos === "player-right" || pos === "player-left";
            const useSideColumn = players.length > 2 && isSide;
            const handStyle = useSideColumn
              ? { flexDirection: "column", alignItems: "center" }
              : undefined;

            return (
              <div className={`player-zone ${pos} ${isTurn ? "current-turn" : ""}`} key={player.id}>
                <div>{player.name}</div>
                <div className="player-hand" style={handStyle}>
                  {isSelf
                    ? renderHandFan() // bottom: your cards
                    : useSideColumn
                    ? renderSideBackColumn(count, pos) // sides: vertical stack, each card rotated to horizontal
                    : renderBackFan(count, pos) // top: horizontal fan, rotated 180°
                  }
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

          {/* UNO button (enabled only when it's your pending UNO and you have exactly 1 card) */}
          <div style={{ position: "absolute", bottom: 12, right: 12 }}>
            <button
              className="uno-btn"
              disabled={!(unoPendingFor === socket.id && hand.length === 1)}
              onMouseDown={() => setUnoPressed(true)}
              onMouseUp={() => setUnoPressed(false)}
              onMouseLeave={() => setUnoPressed(false)}
              onClick={() => socket.emit("declare-uno")}
              title="Call UNO right now"
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
