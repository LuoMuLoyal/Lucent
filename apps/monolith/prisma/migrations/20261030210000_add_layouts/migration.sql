-- CreateTable
CREATE TABLE "layouts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "schema_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "layouts_user_id_surface_key" ON "layouts"("user_id", "surface");

-- AddForeignKey
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
