-- CreateTable
CREATE TABLE "DigestPipelineShare" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "importCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestPipelineShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestPipelineImport" (
    "userId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestPipelineImport_pkey" PRIMARY KEY ("userId","pipelineId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestPipelineShare_ownerUserId_key" ON "DigestPipelineShare"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestPipelineShare_slug_key" ON "DigestPipelineShare"("slug");

-- CreateIndex
CREATE INDEX "DigestPipelineShare_isPublic_idx" ON "DigestPipelineShare"("isPublic");

-- CreateIndex
CREATE INDEX "DigestPipelineImport_pipelineId_idx" ON "DigestPipelineImport"("pipelineId");

-- AddForeignKey
ALTER TABLE "DigestPipelineShare" ADD CONSTRAINT "DigestPipelineShare_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestPipelineImport" ADD CONSTRAINT "DigestPipelineImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestPipelineImport" ADD CONSTRAINT "DigestPipelineImport_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "DigestPipelineShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
