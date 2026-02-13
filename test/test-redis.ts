import { redis } from "@/lib/redis";
async function main() {
  const roomId = "test-room-123";

  const bufferKey = `room:${roomId}:buffer`;
  const cooldownKey = `room:${roomId}:cooldown`;

  console.log("🚀 Start Redis test");

  /* ----------------------------
     2️⃣ Test: add buffer (LIST)
  -----------------------------*/
  console.log("➡️ Add transcript chunks");

  await redis.del(bufferKey); // clear ก่อน
  await redis.rpush(bufferKey, "chunk 1");
  await redis.rpush(bufferKey, "chunk 2");
  await redis.rpush(bufferKey, "chunk 3");

  const buffer = await redis.lrange(bufferKey, 0, -1);
  console.log("Buffer content:", buffer);

  /* ----------------------------
     3️⃣ Test: limit buffer size
  -----------------------------*/
  console.log("➡️ Limit buffer size to last 3");

  await redis.rpush(bufferKey, "chunk 4");
  await redis.ltrim(bufferKey, -3, -1);

  const limitedBuffer = await redis.lrange(bufferKey, 0, -1);
  console.log("Limited buffer:", limitedBuffer);

  /* ----------------------------
     4️⃣ Test: cooldown (STRING)
  -----------------------------*/
  console.log("➡️ Set cooldown");

  await redis.set(cooldownKey, Date.now().toString(), "PX", 60_000);

  const cooldownValue = await redis.get(cooldownKey);
  console.log("Cooldown timestamp:", cooldownValue);

  /* ----------------------------
     5️⃣ Test: TTL
  -----------------------------*/
  const ttl = await redis.pttl(cooldownKey);
  console.log("Cooldown TTL (ms):", ttl);

  /* ----------------------------
     6️⃣ Cleanup
  -----------------------------*/
  await redis.del(bufferKey, cooldownKey);
  await redis.quit();

  console.log("✅ Redis test completed");
}

main().catch((err) => {
  console.error("❌ Redis test failed:", err);
  process.exit(1);
});
