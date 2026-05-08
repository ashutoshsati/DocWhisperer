"""
Document ingestion pipeline.

Takes a file path (PDF, Word doc, plain text, or JSON), splits it into chunks,
embeds each chunk with OpenAI, and persists the embeddings into a local
ChromaDB collection.

Run from the project root:

    python -m Backend.ingest path/to/document.pdf

Requires environment variable OPENAI_API_KEY to be set (see .env.example).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import List

from langchain_community.document_loaders import (
    Docx2txtLoader,
    PyPDFLoader,
    TextLoader,
)
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma


# --- Configuration ---------------------------------------------------------

# Folder where ChromaDB persists its on-disk index. Created on first run.
# Resolved relative to the project root (parent of this file's parent).
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PERSIST_DIRECTORY = str(PROJECT_ROOT / "vector_store")

# Logical name of the Chroma collection. All ingested chunks land here.
# query.py will read from the same collection.
COLLECTION_NAME = "rag_documents"

# Chunking parameters. 1000 chars / 200 char overlap is a sane starting point
# for prose. Larger chunks = more context per snippet but more tokens per
# query (= higher cost and slower retrieval).
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Embedding model. text-embedding-3-small is cheap (~$0.02 per 1M tokens)
# and good enough for most RAG use cases. Bump to text-embedding-3-large
# later if recall is poor.
EMBEDDING_MODEL = "text-embedding-3-small"


# --- Step 1: load the file -------------------------------------------------

def load_document(file_path: str, source_name: str | None = None) -> List[Document]:
    """
    Read a single file off disk and return its text as LangChain Documents.

    Picks the right loader based on file extension. Stamps `source_name`
    (or the file's basename if None) onto each document's metadata so we
    can cite it later. The override exists because the FastAPI /ingest
    endpoint writes uploads to a temp file — without it, citations would
    show "tmp42j8vvk2.docx" instead of "Progress.docx".
    """
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File does not exist: {path}")

    suffix = path.suffix.lower()
    display_name = source_name or path.name
    print(f"[ingest] Loading {display_name} ({suffix}) ...")

    if suffix == ".pdf":
        loader = PyPDFLoader(str(path))
    elif suffix in {".docx", ".doc"}:
        loader = Docx2txtLoader(str(path))
    elif suffix in {".txt", ".md"}:
        loader = TextLoader(str(path), encoding="utf-8")
    elif suffix == ".json":
        # JSON has no single canonical text form, so we don't use a LangChain
        # loader (the built-in JSONLoader needs a jq schema we don't have).
        # Parse to validate, then re-serialize as pretty text — the splitter
        # downstream treats it the same as any other prose.
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        text = json.dumps(data, indent=2, ensure_ascii=False)
        docs = [Document(page_content=text, metadata={"source": display_name})]
        print(f"[ingest]   -> got 1 raw document(s) from JSON ({len(text)} chars)")
        return docs
    else:
        raise ValueError(
            f"Unsupported file type {suffix!r}. "
            "Supported: .pdf, .docx, .doc, .txt, .md, .json"
        )

    docs = loader.load()
    # Overwrite (not setdefault) — most LangChain loaders pre-stamp `source`
    # with the *full file path*, which for our temp-file flow is exactly the
    # value we need to replace.
    for d in docs:
        d.metadata["source"] = display_name

    print(f"[ingest]   -> got {len(docs)} raw document(s) from loader")
    return docs


# --- Step 2: split into chunks --------------------------------------------

def chunk_documents(docs: List[Document]) -> List[Document]:
    """
    Split each document into overlapping chunks small enough for the
    embedding model. Recursive splitter prefers paragraph / sentence
    boundaries before falling back to character splits.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = splitter.split_documents(docs)
    print(f"[ingest]   -> split into {len(chunks)} chunk(s)")
    return chunks


# --- Step 3: embed + persist into ChromaDB --------------------------------

def store_chunks(chunks: List[Document]) -> Chroma:
    """
    Send each chunk to OpenAI for an embedding vector, then upsert into the
    on-disk Chroma collection at PERSIST_DIRECTORY.

    Requires the OPENAI_API_KEY env var to be set.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in, "
            "or `set OPENAI_API_KEY=sk-...` in your shell before running."
        )

    print(f"[ingest]   -> embedding {len(chunks)} chunk(s) with {EMBEDDING_MODEL} ...")
    embeddings = OpenAIEmbeddings(model=EMBEDDING_MODEL)

    vectorstore = Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=PERSIST_DIRECTORY,
    )
    vectorstore.add_documents(chunks)
    print(f"[ingest]   -> persisted to {PERSIST_DIRECTORY}/")
    return vectorstore


# --- Public entry point ---------------------------------------------------

def ingest_file(file_path: str, source_name: str | None = None) -> dict:
    """
    Run the full pipeline (load -> chunk -> embed -> store) for one file.

    `source_name` overrides the citation label baked into chunk metadata —
    used by the API to keep the user-facing filename intact when ingesting
    from a temp upload path.

    Returns a summary dict so callers (the FastAPI /ingest endpoint, the
    CLI below) can report back to the user.
    """
    docs = load_document(file_path, source_name=source_name)
    chunks = chunk_documents(docs)
    store_chunks(chunks)
    return {
        "filename": source_name or Path(file_path).name,
        "raw_documents": len(docs),
        "chunks": len(chunks),
    }


# --- CLI ------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m Backend.ingest <path-to-document>")
        sys.exit(1)

    try:
        summary = ingest_file(sys.argv[1])
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        print(f"[ingest] ERROR: {e}")
        sys.exit(1)

    print(f"[ingest] DONE: {summary}")
