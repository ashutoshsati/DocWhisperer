"""
Query pipeline.

Takes a user question, retrieves the most relevant chunks from the ChromaDB
collection (populated by ingest.py), and asks GPT-4o for a grounded answer.

Run from the project root:

    python -m Backend.query "What does the document say about X?"

Requires environment variable OPENAI_API_KEY to be set (see .env.example).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import List

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings


# --- Configuration ---------------------------------------------------------

# These three MUST match the values in Backend/ingest.py — they identify the
# same ChromaDB collection and the same embedding space. If they drift,
# similarity search will silently return nothing useful.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PERSIST_DIRECTORY = str(PROJECT_ROOT / "vector_store")
COLLECTION_NAME = "rag_documents"
EMBEDDING_MODEL = "text-embedding-3-small"

# Chat model. GPT-4o is the default per CLAUDE.md. Swap to gpt-4o-mini
# while developing if you want to keep costs down.
CHAT_MODEL = "gpt-4o"

# How many chunks to feed the LLM. 4 is a fine starting point. Higher = more
# context (better recall) but more tokens per call.
TOP_K = 4

# 0 = deterministic answers. Bump for more varied phrasing.
TEMPERATURE = 0

# Instruction to the model: ground answers in the retrieved context and
# admit when the answer isn't there. This is what stops the LLM from
# hallucinating outside the documents.
SYSTEM_PROMPT = (
    "You are a helpful assistant that answers questions using ONLY the "
    "provided context. If the answer cannot be found in the context, "
    "respond exactly: \"I don't know based on the provided documents.\" "
    "When you state a fact, mention which numbered source it came from "
    "(e.g. [1], [2])."
)


# --- Step 1: open the existing vector store --------------------------------

def get_vectorstore() -> Chroma:
    """
    Open the on-disk Chroma collection that ingest.py populated.

    Does NOT re-embed anything — it just hooks into the existing index.
    Still needs OPENAI_API_KEY because Chroma calls the embedding function
    to embed the *query* at retrieval time.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in, "
            "or `set OPENAI_API_KEY=sk-...` in your shell before running."
        )
    embeddings = OpenAIEmbeddings(model=EMBEDDING_MODEL)
    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=PERSIST_DIRECTORY,
    )


# --- Step 2: retrieve the most relevant chunks -----------------------------

def retrieve_chunks(query: str, k: int = TOP_K) -> List[Document]:
    """
    Find the k chunks whose embeddings are closest to the query embedding.

    Each returned Document carries:
        .page_content — the chunk text
        .metadata     — at minimum {"source": filename}, plus loader-specific
                        fields like {"page": int} for PDFs.
    """
    vectorstore = get_vectorstore()
    print(f"[query]   -> searching for top {k} chunks ...")
    chunks = vectorstore.similarity_search(query, k=k)
    print(f"[query]   -> retrieved {len(chunks)} chunk(s)")
    return chunks


# --- Step 3: build the prompt with retrieved context -----------------------

def build_prompt_messages(query: str, chunks: List[Document]) -> List[BaseMessage]:
    """
    Assemble the system + user messages we'll send to the chat model.

    The user message contains the retrieved chunks, each prefixed with a
    [N] tag and its source filename so the model can cite them.
    """
    context_blocks = []
    for i, chunk in enumerate(chunks, start=1):
        source = chunk.metadata.get("source", "unknown")
        page = chunk.metadata.get("page")  # PyPDFLoader sets this; others may not
        header = f"[{i}] source={source}" + (f" page={page}" if page is not None else "")
        context_blocks.append(f"{header}\n{chunk.page_content}")

    # Separator chosen to be visually distinct in the prompt.
    context = "\n\n---\n\n".join(context_blocks) if context_blocks else "(no context retrieved)"

    user_message = (
        f"Context:\n{context}\n\n"
        f"Question: {query}\n\n"
        f"Answer:"
    )

    return [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=user_message),
    ]


# --- Step 4: call the LLM --------------------------------------------------

def generate_answer(messages: List[BaseMessage]) -> tuple[str, dict]:
    """
    Send the prompt to the chat model and return the plain-text answer
    plus a token-usage dict pulled off the response.

    Usage shape: {"input_tokens": int, "output_tokens": int, "total_tokens": int}.
    Falls back to zeros if the provider didn't include usage metadata.
    """
    print(f"[query]   -> calling {CHAT_MODEL} ...")
    chat = ChatOpenAI(model=CHAT_MODEL, temperature=TEMPERATURE)
    response = chat.invoke(messages)
    # response.content is typed str | list — for OpenAI text completions
    # it's always a string, but cast defensively.
    answer = str(response.content).strip()

    raw_usage = getattr(response, "usage_metadata", None) or {}
    usage = {
        "input_tokens": int(raw_usage.get("input_tokens", 0)),
        "output_tokens": int(raw_usage.get("output_tokens", 0)),
        "total_tokens": int(raw_usage.get("total_tokens", 0)),
    }
    print(f"[query]   -> usage: {usage}")
    return answer, usage


# --- Public entry point ----------------------------------------------------

def answer_query(query: str) -> dict:
    """
    End-to-end: retrieve relevant chunks, ask the LLM, return answer + sources.

    Returns {"answer": str, "sources": list[str], "usage": {...}} — this matches
    the contract the React frontend expects (see Frontend/App.tsx handleSend).
    `usage` carries chat-completion token counts; embeddings (ingest-time) are
    not tracked here.
    """
    empty_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    query = query.strip()
    if not query:
        return {"answer": "Please ask a non-empty question.", "sources": [], "usage": empty_usage}

    print(f"[query] Answering: {query!r}")
    chunks = retrieve_chunks(query)

    # Deduplicate source filenames in retrieval order — one mention per source
    # is plenty for the frontend's citation chips.
    seen_sources: List[str] = []
    for chunk in chunks:
        src = chunk.metadata.get("source")
        if src and src not in seen_sources:
            seen_sources.append(src)

    # Short-circuit: no docs ingested yet (or none matched).
    if not chunks:
        return {
            "answer": "No documents have been ingested yet — upload one first using POST /ingest.",
            "sources": [],
            "usage": empty_usage,
        }

    messages = build_prompt_messages(query, chunks)
    answer, usage = generate_answer(messages)
    print(f"[query] DONE (sources: {seen_sources})")
    return {"answer": answer, "sources": seen_sources, "usage": usage}


# --- CLI -------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python -m Backend.query "your question here"')
        sys.exit(1)

    # Join all argv parts so unquoted multi-word queries still work.
    user_query = " ".join(sys.argv[1:])

    try:
        result = answer_query(user_query)
    except RuntimeError as e:
        print(f"[query] ERROR: {e}")
        sys.exit(1)

    print()
    print("=" * 60)
    print("ANSWER:")
    print(result["answer"])
    print()
    print("SOURCES:", ", ".join(result["sources"]) or "(none)")
