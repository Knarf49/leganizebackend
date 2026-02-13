import type { Response } from "express";

// Global singleton to persist across module reloads in Next.js
declare global {
  var __sseClients: Map<string, Set<Response>> | undefined;
}

/**
 * Global clients map - singleton instance that persists across Next.js module reloads
 * roomId -> set of client responses
 */
const clients = globalThis.__sseClients ?? new Map<string, Set<Response>>();
globalThis.__sseClients = clients;

// Debug: Log when module is loaded
// console.log(`📦 [SSE] Module loaded, clients map size: ${clients.size}`);

export function addClient(roomId: string, res: Response) {
  // console.log(`👤 [SSE] addClient called - roomId: ${roomId}`);
  // console.log(
  //   `👤 [SSE] Current clients before add:`,
  //   Array.from(clients.keys()),
  // );
  const set = clients.get(roomId) ?? new Set<Response>();
  set.add(res);
  // clients.set(roomId, set);
  // console.log(`📊 [SSE] Total clients in room ${roomId}: ${set.size}`);
  // console.log(
  //   `📋 [SSE] All rooms with clients after add:`,
  //   Array.from(clients.keys()),
  // );
  // console.log(`📋 [SSE] Clients map reference:`, clients);
}

export function removeClient(roomId: string, res: Response) {
  console.log(`👤 Removing client from room: ${roomId}`);
  const set = clients.get(roomId);
  if (!set) {
    console.log(`⚠️ No client set found for room: ${roomId}`);
    return;
  }

  set.delete(res);
  if (set.size === 0) {
    clients.delete(roomId);
    // console.log(`🗑️ Deleted empty client set for room: ${roomId}`);
  } else {
    // console.log(`📊 Remaining clients in room ${roomId}: ${set.size}`);
  }
}

/**
 * ใช้เรียกจาก legalAnalyze
 */
export function emitLegalEvent(roomId: string, data: any) {
  console.log(`📡 [SSE] emitLegalEvent called for room: ${roomId}`);
  // console.log(`📋 [SSE] Clients map reference at emit:`, clients);
  // console.log(`📋 [SSE] Current clients map keys:`, Array.from(clients.keys()));
  // console.log(`📊 [SSE] Total rooms with clients: ${clients.size}`);

  const set = clients.get(roomId);
  if (!set) {
    console.log(`❌ [SSE] No clients connected to room: ${roomId}`);
    console.log(`📋 [SSE] Available rooms:`, Array.from(clients.keys()));
    return;
  }

  console.log(
    `👥 [SSE] Found ${set.size} connected clients for room: ${roomId}`,
  );
  const payload = `event: legal-risk\n` + `data: ${JSON.stringify(data)}\n\n`;
  console.log(`📤 [SSE] Sending payload:`, payload.substring(0, 100) + "...");

  let successCount = 0;
  let errorCount = 0;

  for (const res of set) {
    try {
      res.write(payload);
      successCount++;
      console.log(`✅ [SSE] Sent to client successfully`);
    } catch (error) {
      errorCount++;
      console.error(`❌ [SSE] Failed to send to client:`, error);
    }
  }

  console.log(
    `📤 [SSE] Emit summary: ${successCount} success, ${errorCount} errors`,
  );
}
