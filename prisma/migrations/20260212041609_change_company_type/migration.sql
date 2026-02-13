/*
  Warnings:

  - The `companyType` column on the `Room` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('LIMITED', 'PUBLIC_LIMITED');

-- AlterTable
ALTER TABLE "Room" DROP COLUMN "companyType",
ADD COLUMN     "companyType" "CompanyType" NOT NULL DEFAULT 'LIMITED';
