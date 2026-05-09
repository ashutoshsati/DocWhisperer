---
title: DocWhisperer
emoji: 💬
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
---

# DocWhisperer

A Retrieval-Augmented Generation (RAG) chatbot. Upload PDF, DOCX, TXT, MD, or
JSON files and ask questions about them. Built with FastAPI, ChromaDB, and
React, backed by OpenAI's `text-embedding-3-small` and `gpt-4o`.

## Configuration

Set `OPENAI_API_KEY` as a secret in the Hugging Face Space's settings
(Settings → Variables and secrets → New secret).

## Architecture

See `docs/architecture.md` for a full walkthrough of the codebase and the
ingest / query / reset flows.
