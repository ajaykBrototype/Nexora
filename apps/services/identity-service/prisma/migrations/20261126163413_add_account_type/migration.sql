-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CANDIDATE', 'COMPANY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "account_type" "AccountType" NOT NULL DEFAULT 'CANDIDATE';
