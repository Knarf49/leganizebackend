-- CreateIndex
CREATE INDEX "AnalysisLog_roomId_idx" ON "AnalysisLog"("roomId");

-- CreateIndex
CREATE INDEX "LegalRisk_roomId_idx" ON "LegalRisk"("roomId");

-- CreateIndex
CREATE INDEX "TranscriptChunk_roomId_idx" ON "TranscriptChunk"("roomId");

-- AddForeignKey
ALTER TABLE "TranscriptChunk" ADD CONSTRAINT "TranscriptChunk_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRisk" ADD CONSTRAINT "LegalRisk_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisLog" ADD CONSTRAINT "AnalysisLog_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
