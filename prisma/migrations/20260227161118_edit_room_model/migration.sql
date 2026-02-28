-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('AGM', 'EGM', 'BOD');

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "agendas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "calledBy" TEXT NOT NULL DEFAULT 'System',
ADD COLUMN     "location" TEXT NOT NULL DEFAULT 'Not specified',
ADD COLUMN     "meetingType" "MeetingType" NOT NULL DEFAULT 'BOD';
