import "dotenv/config";
import express from "express";
import next from "next";
import { addClient, removeClient } from "./sse";
import { createServer } from "http";
import { initializeWebSocketServer } from "./websocket";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const app = express();
  const httpServer = createServer(app);

  console.log("🚀 Initializing WebSocket server...");
  initializeWebSocketServer(httpServer);
  console.log("✅ WebSocket server initialized");
  app.get("/room/:id/events", (req, res) => {
    const roomId = req.params.id;
    console.log(`🔌 SSE client connecting to room: ${roomId}`);
    console.log(`🌐 Request headers:`, req.headers);

    // CORS headers for SSE
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    addClient(roomId, res);
    const initialMessage = `event: connected\ndata: ${JSON.stringify({ roomId, timestamp: new Date().toISOString() })}\n\n`;
    res.write(initialMessage);
    console.log(`✅ SSE client added to room: ${roomId}, sent initial message`);

    req.on("close", () => {
      console.log(`🔌 SSE client disconnected from room: ${roomId}`);
      removeClient(roomId, res);
    });

    req.on("error", (err) => {
      console.error(`❌ SSE request error for room ${roomId}:`, err);
      removeClient(roomId, res);
    });
  });

  app.use((req, res) => handle(req, res));

  httpServer.listen(port, () => {
    console.log(`Server ready on http://localhost:${port}`);
  });
});
