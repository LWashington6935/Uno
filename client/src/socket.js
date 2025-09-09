// client/src/socket.js

import { io } from "socket.io-client";

// Connect to your backend server (adjust if your backend runs on a different host or port)
const socket = io("http://localhost:3001", {
  transports: ["websocket"], // Optional: helps avoid polling fallback
});

export default socket;
