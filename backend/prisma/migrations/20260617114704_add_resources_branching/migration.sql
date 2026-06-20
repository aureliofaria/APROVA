-- AlterTable
ALTER TABLE "Request" ADD COLUMN "replacementName" TEXT;
ALTER TABLE "Request" ADD COLUMN "vacancyType" TEXT;

-- CreateTable
CREATE TABLE "ResourceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'EQUIPMENT',
    "sectorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResourceItem_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "resourceItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestResource_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequestResource_resourceItemId_fkey" FOREIGN KEY ("resourceItemId") REFERENCES "ResourceItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FlowStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowTemplateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requiredRole" TEXT,
    "requiresAttachment" BOOLEAN NOT NULL DEFAULT false,
    "deadlineHours" INTEGER,
    "handlingSectorId" TEXT,
    "slaExpiry" TEXT NOT NULL DEFAULT 'KEEP_WITH_RESPONSIBLE',
    "conditions" TEXT,
    "activateOnSectorId" TEXT,
    "collectsResources" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowStep_flowTemplateId_fkey" FOREIGN KEY ("flowTemplateId") REFERENCES "FlowTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlowStep_handlingSectorId_fkey" FOREIGN KEY ("handlingSectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FlowStep_activateOnSectorId_fkey" FOREIGN KEY ("activateOnSectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FlowStep" ("createdAt", "deadlineHours", "description", "flowTemplateId", "handlingSectorId", "id", "name", "order", "requiredRole", "requiresAttachment", "slaExpiry") SELECT "createdAt", "deadlineHours", "description", "flowTemplateId", "handlingSectorId", "id", "name", "order", "requiredRole", "requiresAttachment", "slaExpiry" FROM "FlowStep";
DROP TABLE "FlowStep";
ALTER TABLE "new_FlowStep" RENAME TO "FlowStep";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RequestResource_requestId_resourceItemId_key" ON "RequestResource"("requestId", "resourceItemId");
