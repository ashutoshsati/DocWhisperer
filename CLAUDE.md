# RAG Document Chatbot

## Project overview
A RAG chatbot that lets users upload PDFs/Word docs and ask questions about them.

## Tech stack
- Backend: Python, FastAPI, LangChain
- Vector DB: ChromaDB (local)
- Embeddings: OpenAI text-embedding-3-small
- LLM: OpenAI GPT-4o (or Claude via API)
- Frontend: React 19 + TypeScript + Vite + TailwindCSS (in `Frontend/`)

## Project structure
- Backend/ingest.py  — parsing, chunking, embedding
- Backend/query.py   — vector search + LLM call
- Backend/main.py    — FastAPI endpoints (expects `POST /query` and `POST /ingest`)
- Frontend/App.tsx   — React UI; calls backend via `VITE_API_URL` (defaults to http://localhost:8000)

## Coding preferences
- Use clear variable names, add comments explaining each step
- Keep functions small and single-purpose
- Print progress steps so I can see what's happening

## Current focus
Building the ingestion pipeline first (ingest.py)