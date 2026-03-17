-- Delete orphaned rows that would violate FK constraints
DELETE FROM "TranscriptChunk" WHERE "roomId" NOT IN (SELECT "id" FROM "Room");
DELETE FROM "LegalRisk" WHERE "roomId" NOT IN (SELECT "id" FROM "Room");
DELETE FROM "AnalysisLog" WHERE "roomId" NOT IN (SELECT "id" FROM "Room");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnalysisLog_roomId_idx" ON "AnalysisLog"("roomId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalRisk_roomId_idx" ON "LegalRisk"("roomId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TranscriptChunk_roomId_idx" ON "TranscriptChunk"("roomId");

-- AddForeignKey
ALTER TABLE "TranscriptChunk" ADD CONSTRAINT "TranscriptChunk_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRisk" ADD CONSTRAINT "LegalRisk_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisLog" ADD CONSTRAINT "AnalysisLog_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
