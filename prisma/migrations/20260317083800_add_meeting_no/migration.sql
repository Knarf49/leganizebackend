-- DropForeignKey
ALTER TABLE "AnalysisLog" DROP CONSTRAINT "AnalysisLog_roomId_fkey";

-- DropForeignKey
ALTER TABLE "LegalRisk" DROP CONSTRAINT "LegalRisk_roomId_fkey";

-- DropForeignKey
ALTER TABLE "TranscriptChunk" DROP CONSTRAINT "TranscriptChunk_roomId_fkey";

-- DropIndex
DROP INDEX "AnalysisLog_roomId_idx";

-- DropIndex
DROP INDEX "LegalRisk_roomId_idx";

-- DropIndex
DROP INDEX "TranscriptChunk_roomId_idx";

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "meetingNo" TEXT NOT NULL DEFAULT '1/2569';
