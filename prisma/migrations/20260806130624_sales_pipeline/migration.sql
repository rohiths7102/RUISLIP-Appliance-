-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Enquiry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productCode" TEXT NOT NULL DEFAULT '',
    "productTitle" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'product',
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT NOT NULL DEFAULT '',
    "quotedPrice" REAL,
    "lastEmailedAt" DATETIME,
    "aiDraftSubject" TEXT NOT NULL DEFAULT '',
    "aiDraftBody" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Enquiry" ("createdAt", "email", "id", "message", "name", "phone", "productCode", "productTitle", "source", "status") SELECT "createdAt", "email", "id", "message", "name", "phone", "productCode", "productTitle", "source", "status" FROM "Enquiry";
DROP TABLE "Enquiry";
ALTER TABLE "new_Enquiry" RENAME TO "Enquiry";
CREATE INDEX "Enquiry_status_idx" ON "Enquiry"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
