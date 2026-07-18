-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('pending', 'parsing', 'planning', 'committing', 'done', 'error');

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'pending',
    "counts" JSONB,
    "anomalies_count" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_created_at_idx" ON "import_runs"("created_at");

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
