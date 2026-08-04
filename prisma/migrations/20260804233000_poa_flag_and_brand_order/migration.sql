-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 100,
    "requiresLogoPermissionReview" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Brand" ("description", "id", "isVisible", "logo", "name", "productCount", "requiresLogoPermissionReview", "slug", "sourceUrl") SELECT "description", "id", "isVisible", "logo", "name", "productCount", "requiresLogoPermissionReview", "slug", "sourceUrl" FROM "Brand";
DROP TABLE "Brand";
ALTER TABLE "new_Brand" RENAME TO "Brand";
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");
CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "priceOnApplication" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT NOT NULL DEFAULT '',
    "seoDescription" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("description", "id", "image", "isVisible", "name", "order", "parentId", "productCount", "seoDescription", "seoTitle", "slug", "sourceUrl") SELECT "description", "id", "image", "isVisible", "name", "order", "parentId", "productCount", "seoDescription", "seoTitle", "slug", "sourceUrl" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
