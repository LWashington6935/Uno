[![Watch the demo](https://img.youtube.com/vi/1pM6mVItgAc/hqdefault.jpg)](https://youtu.be/1pM6mVItgAc "Play video on YouTube")
# UNO-Style Realtime Game (React + Socket.IO)

A fast, multiplayer, UNO-style card game you can run locally or deploy. This README explains **what it does**, **how it works**, **the rules we implemented**, and **how to run, extend, and deploy it**. It also documents the **Socket.IO events** and several implementation details that typically trip people up (e.g., Uno declarations, draw-and-play, reverse logic, and removing wilds/draw4 from hands correctly).

> ⚠️ **Trademark note**: UNO is a registered trademark of Mattel. This project is an educational, non-commercial clone. If you intend to publish or monetize, consult legal counsel and Mattel for permissions and branding guidance.

---

## Table of Contents

* [Demo & Features](#demo--features)
* [Game Rules Implemented](#game-rules-implemented)
* [Tech Stack](#tech-stack)
* [Project Structure](#project-structure)
* [Quick Start (Local)](#quick-start-local)
* [Available Scripts](#available-scripts)
* [How Gameplay Works (Server Logic)](#how-gameplay-works-server-logic)

  * [Turn Order & Direction](#turn-order--direction)
  * [Reverse, Skip, Draw 2, Draw 4](#reverse-skip-draw-2-draw-4)
  * [Wild & Draw 4 Color Selection](#wild--draw-4-color-selection)
  * [UNO Declaration Window](#uno-declaration-window)
  * [Draw-and-Play](#draw-and-play)
  * [Winning Condition](#winning-condition)
* [Socket.IO Contract](#socketio-contract)

  * [Client → Server Events](#client--server-events)
  * [Server → Client Events](#server--client-events)
* [Assets](#assets)
* [Accessibility & UX Details](#accessibility--ux-details)
* [Common Pitfalls & Troubleshooting](#common-pitfalls--troubleshooting)
* [Deployment Notes](#deployment-notes)
* [Roadmap / Ideas](#roadmap--ideas)
* [Contributing](#contributing)
* [License](#license)

---

## Demo & Features

**Multiplayer, realtime gameplay** using Socket.IO. One player starts the game; others join, draw, and play cards in turn.

**Key features**

* ✅ Live turn indicator (glow) on the active player
* ✅ Wild & Wild Draw 4 with **color selection**
* ✅ **Reverse** changes direction (special handling for 2 players)
* ✅ **Draw-and-Play**: if you draw because you had no playable card and the drawn card is playable, you can immediately play it
* ✅ **UNO button**: must be pressed when you play down to 1 card (before the next player acts), or you draw 2 as a penalty
* ✅ **Win detection**: first to 0 cards wins; **big winner banner** appears for all players
* ✅ Clean separation of client (React) and server (Node/Express) with clear Socket events
* ✅ Prevents illegal Draw 4 (you can’t play it if you still have a card of the current color)

---

## Game Rules Implemented

* **Matching**: Play a card if it matches the **color** or **value** of the top card, or is a **Wild / Wild Draw 4**.
* **Reverse**: Flips direction. With 2 players it behaves like **Skip** (same player goes again).
* **Skip**: Skips the next player.
* **Draw 2**: Next player draws 2 and is **skipped**.
* **Wild**: Player chooses the new color.
* **Wild Draw 4**: Player chooses a color; next player draws 4 and is **skipped**. **Legality check**: you may play Draw 4 **only if** you have **no cards of the current top color** in your hand.
* **UNO**: If your play leaves you with **exactly 1 card**, you must press **UNO** before the next player acts. If you don’t, you’re penalized **+2** automatically.
* **Draw-and-Play**: If you draw because you have no playable cards and the drawn card is playable (and legal), you may immediately play it (turn stays with you).
* **Win**: First player to **0 cards** wins immediately; game ends and winner banner shows.

---

## Tech Stack

* **Client**: React (Vite), vanilla CSS
* **Realtime**: Socket.IO
* **Server**: Node.js, Express
* **Images**: Static `/cards/*.jpg` files (fronts & back)

---

## Project Structure

```
uno-realtime/
├─ client/
│  ├─ src/
│  │  ├─ App.jsx          # Main UI + Socket.IO client handlers
│  │  └─ App.css          # Styling (table, piles, glow, UNO banners, winner popup)
│  ├─ public/
│  │  └─ cards/           # card images: red_0.jpg ... wild_draw4.jpg, back.jpg
│  ├─ index.html
│  └─ vite.config.js
└─ server/
   ├─ server.js           # Game state, rules, Socket.IO server
   └─ package.json
```

---

## Quick Start (Local)

### 1) Start the server

```bash
cd server
npm install
npm start
# Server on http://localhost:3001
```

### 2) Start the client

```bash
cd ../client
npm install
npm run dev
# Vite dev server on http://localhost:5173
```

Open multiple browser tabs to simulate multiple players. Enter a name, join the lobby, and click **Start Game**.

> If the client can’t connect, check that the Socket.IO URL in `App.jsx` matches your server URL (default `http://localhost:3001`).

---

## Available Scripts

**Server**

* `npm start` — start Express + Socket.IO

**Client**

* `npm run dev` — start Vite dev server
* `npm run build` — production build
* `npm run preview` — preview production build locally

---

## How Gameplay Works (Server Logic)

The server is the source of truth: **hands**, **deck**, **turn**, **direction**, **top card**.

### Turn Order & Direction

* `currentTurnIndex` points to `players[currentTurnIndex]`.
* `direction` is `+1` (clockwise) or `-1` (counter-clockwise).
* Move by `advanceTurn(steps)` which wraps with a modular index.

### Reverse, Skip, Draw 2, Draw 4

* **Skip**: `advanceTurn(2)`
* **Reverse**:

  * Flip `direction *= -1`
  * If `players.length === 2`: reverse acts as **skip** (same player goes again)
  * Else: `advanceTurn(1)`
* **Draw 2**: Next player draws 2 (server pushes cards to them and emits `card-drawn`). Then `advanceTurn(2)`.
* **Draw 4**: Legality check first. If legal, next player draws 4 and is skipped (`advanceTurn(2)`).

### Wild & Draw 4 Color Selection

* Client displays a **color picker** when a wild/draw4 is clicked.
* Client then sends `play-card` with the card object including the **chosen color**.
* Server validates, removes the card from **handsById**, updates `topCard`, applies effects.

### UNO Declaration Window

* When your play leaves you with **exactly 1 card**:

  * If you sent `unoDeclared: true` with the `play-card` event, server accepts UNO immediately.
  * Else, the server sets `unoPendingFor = yourSocketId` and emits `uno-window`.
  * If **any other player acts** (plays or draws) while UNO is pending, the server **penalizes** the offender (+2) and emits `uno-result` (fail). This is performed by `settlePendingUnoBeforeAction(actorId)`.
* When you click **UNO** (client emits `declare-uno`), server validates:

  * Must be **you**
  * You must have **exactly 1 card**
  * `unoPendingFor` must equal your id
    If valid, emits `uno-result` (ok) and clears pending.

### Draw-and-Play

* When you emit `draw-card`, server gives you one card and **keeps the turn with you** if that drawn card is playable (and legal, e.g. not Draw 4 when you still have the top color).
* If **not** playable, server advances the turn to the next player and emits `turn-changed`.

### Winning Condition

* After **every play** (before advancing the turn), the server checks the acting player’s hand. If it’s **0**, it emits `game-won` and stops further turn logic for that play.

---

## Socket.IO Contract

### Client → Server Events

| Event         | Payload                           | Description                                                                                                                   |
| ------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `new-player`  | `name: string`                    | Join lobby with a display name                                                                                                |
| `start-game`  | –                                 | Host starts the match                                                                                                         |
| `play-card`   | `{ card, unoDeclared?: boolean }` | Play a card (for wild/draw4 include selected `color`; optionally set `unoDeclared: true` when this play leaves you at 1 card) |
| `draw-card`   | –                                 | Draw one card; if playable, you may immediately play it                                                                       |
| `declare-uno` | –                                 | Press UNO (valid only when you have 1 card and are pending)                                                                   |

### Server → Client Events

| Event            | Payload                                     | Description                                          |
| ---------------- | ------------------------------------------- | ---------------------------------------------------- |
| `update-players` | `players: Array<{id,name}>`                 | Lobby/player list updates                            |
| `game-started`   | `{ hands, topCard, currentPlayerId }`       | Initial deal & turn                                  |
| `card-played`    | `{ card, playerId, nextPlayerId, topCard }` | A card was played & turn computed                    |
| `card-drawn`     | `card`                                      | You drew a card                                      |
| `turn-changed`   | `nextPlayerId`                              | Turn passed after a failed draw-and-play             |
| `invalid-play`   | `{ message }`                               | Rule violation or wrong timing                       |
| `uno-window`     | `{ playerId }`                              | Player must press UNO now (until next player acts)   |
| `uno-result`     | `{ playerId, ok, penalty }`                 | UNO declared or missed (+2)                          |
| `game-won`       | `{ playerId, name }`                        | Winner announcement                                  |
| `update-hands`   | `hands`                                     | Mirror of server hands (used to keep counts in sync) |

---

## Assets

* Place card images under `client/public/cards/` named like:

  * `red_0.jpg`, `red_1.jpg`, ..., `green_7.jpg`, `blue_reverse.jpg`, `yellow_draw2.jpg`
  * Wilds: `wild_wild.jpg`, `wild_draw4.jpg`
  * Card back: `back.jpg`
* Client renders images from `/cards/<color>_<value>.jpg`.

---

## Accessibility & UX Details

* The active player’s “seat” gets a **glowing outline** (`.current-turn`) so everyone knows whose turn it is.
* UNO banners show for **3 seconds** (`uno-result`) with success/failure colors.
* Winner overlay shows a **big** modal with the player name.
* Buttons and cards have **hover/focus** states.
* Alerts (for invalid plays) indicate **why** an action is blocked.

---

## Common Pitfalls & Troubleshooting

**Wild/Draw4 not removed from hand**

* The server removes the card from `handsById` by matching `{color,value}` and then emits `update-hands` and `card-played`. The client **also** filters the played card out of local state. If you see duplicates:

  * Ensure the client’s remove logic handles **wild/draw4** by **value** only (since their `color` may change).
  * Confirm the server emits `update-hands` after each play; the client uses it to stay in sync.

**UNO button doesn’t enable**

* The button is enabled only when `unoPendingFor === socket.id` **and** your hand length is `1`.
  If you want “pre-UNO” (declare at the same moment as playing to 1), send `play-card` with `{ unoDeclared: true }`.

**Draw-and-Play not working**

* The server keeps the turn if the just-drawn card is playable (and Draw 4 legality passes). If you cannot click it:

  * Verify the client’s `hasPlayableCard` isn’t blocking clicks when it should not.
  * Confirm the server **did not** emit `turn-changed` after the draw (it should not when playable).

**Reverse still going the wrong way**

* With 2 players, reverse acts like **skip** (same player goes again). With 3+, `direction *= -1` and `advanceTurn(1)`.

**Client can’t connect to server**

* Check the Socket.IO client URL in `App.jsx` matches your server origin and port.
* CORS in `server.js` must allow the client origin (e.g., `http://localhost:5173`).

---

## Deployment Notes

* Change the Socket.IO URL in the client from `http://localhost:3001` to your deployed server URL.
* Serve card assets from a static host (your production server or CDN).
* For single-server deployment, you can:

  * Host the **server** (Node + Socket.IO) on a VM/host (Railway/Render/Heroku-like)
  * Host the **client** as static files (e.g., Netlify, Vercel) or behind the same Node server (serve `client/dist`).
* Make sure CORS settings match the production domains.

---

## Roadmap / Ideas

* Timed turns; auto-draw if time expires
* Stacking Draw 2 / Draw 4 variants (house rules)
* Spectator mode
* Private rooms with codes
* Auth / persistent profiles & ELO
* Mobile-friendly controls & larger card UI
* Sounds & animations
* Comprehensive unit and integration tests (server rules & client reducers)

---

## Contributing

PRs and issues are welcome! Please:

1. Open an issue describing the change/bug.
2. Create a feature branch.
3. Add tests or reproduction steps where applicable.
4. Follow the existing code style.

---

## License

This project is for educational use. UNO and all related marks are trademarks of Mattel. Do **not** use their branding or assets in a commercial context without permission. Include your preferred open-source license here (e.g., MIT/Apache-2.0), and ensure you respect third-party licenses for any assets you add.

---

### Credits

Built with ❤️ using React, Vite, Node, Express, and Socket.IO.
