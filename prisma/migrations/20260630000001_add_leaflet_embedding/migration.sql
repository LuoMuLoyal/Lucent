-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to leaflet chunks (nullable initially)
ALTER TABLE "medicine_leaflet_chunks"
  ADD COLUMN "embedding" vector(1536);

-- HNSW index for fast cosine similarity search
CREATE INDEX "medicine_leaflet_chunks_embedding_idx"
  ON "medicine_leaflet_chunks"
  USING hnsw ("embedding" vector_cosine_ops);
