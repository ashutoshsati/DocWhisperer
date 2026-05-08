"""
FastAPI application for the RAG chatbot.

Wires the React frontend (Frontend/App.tsx) to the two pipelines:
    POST /ingest   -- multipart upload -> Backend.ingest.ingest_file
    POST /query    -- {"query": str}   -> Backend.query.answer_query

Run from the project root:

    uvicorn Backend.main:app --reload --port 8000

Requires OPENAI_API_KEY (loaded from .env automatically).
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load .env BEFORE importing the pipeline modules — they read OPENAI_API_KEY
# only when their functions are called, but loading early keeps surprises low.
load_dotenv()

from Backend.ingest import ingest_file
from Backend.query import answer_query


# --- App + CORS ------------------------------------------------------------

app = FastAPI(title="RAG Chatbot API", version="1.0.0")

# Allow the Vite dev server (and any other localhost port) to call us during
# development. Tighten this list before deploying anywhere public.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request / response models --------------------------------------------

class QueryRequest(BaseModel):
    # Matches the JSON the frontend sends in handleSend(): { query: string }.
    query: str = Field(..., min_length=1, description="User question to answer from ingested docs.")


# --- Routes ----------------------------------------------------------------

@app.get("/")
def root():
    """Tiny healthcheck so a browser hit on http://localhost:8000 shows life."""
    return {"status": "ok", "service": "rag-chatbot"}


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    """
    Accept one uploaded document, run it through the ingestion pipeline, and
    return a summary the frontend can show in its 'Sources in Use' panel.
    """
    # Preserve the original suffix so ingest.load_document picks the right loader.
    original_name = file.filename or "upload"
    suffix = Path(original_name).suffix

    print(f"[api] /ingest received {original_name!r} ({file.content_type})")

    # Stream the upload to a temp file. Chroma's loaders all want a real path.
    # delete=False on Windows so we can close the handle before the loader opens it.
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        contents = await file.read()
        tmp.write(contents)
        tmp.close()

        try:
            # Pass the original filename so chunk metadata (and the response)
            # cite "Progress.docx", not the tempfile basename.
            summary = ingest_file(tmp.name, source_name=original_name)
        except ValueError as e:
            # Unsupported file type — surface the message verbatim to the UI.
            raise HTTPException(status_code=400, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except RuntimeError as e:
            # Most commonly: OPENAI_API_KEY missing.
            raise HTTPException(status_code=500, detail=str(e))

        return summary
    finally:
        # Always clean up the temp file, even on error.
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@app.post("/query")
def query(req: QueryRequest):
    """
    Answer a user question using the ChromaDB collection populated by /ingest.
    Returns {"answer": str, "sources": list[str]} — see Frontend handleSend().
    """
    print(f"[api] /query received: {req.query!r}")
    try:
        return answer_query(req.query)
    except RuntimeError as e:
        # Missing API key, etc.
        raise HTTPException(status_code=500, detail=str(e))
