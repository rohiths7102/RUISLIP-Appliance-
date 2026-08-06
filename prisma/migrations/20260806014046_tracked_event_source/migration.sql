-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TrackedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '',
    "productSlug" TEXT NOT NULL DEFAULT '',
    "postcode" TEXT NOT NULL DEFAULT '',
    "isLocal" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_TrackedEvent" ("createdAt", "id", "isLocal", "path", "postcode", "productSlug", "type") SELECT "createdAt", "id", "isLocal", "path", "postcode", "productSlug", "type" FROM "TrackedEvent";
DROP TABLE "TrackedEvent";
ALTER TABLE "new_TrackedEvent" RENAME TO "TrackedEvent";
CREATE INDEX "TrackedEvent_type_createdAt_idx" ON "TrackedEvent"("type", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
