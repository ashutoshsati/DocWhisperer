---
title: DocWhisperer
emoji: 💬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# DocWhisperer

A **Retrieval-Augmented Generation (RAG) chatbot** that lets you upload documents (PDF, DOCX, TXT, MD, JSON) and ask questions about them. Answers cite the chunks they came from, so you can always verify what the model is grounding its reply on.

**Live demo:** https://huggingface.co/spaces/ashutoshsati/docwhisperer

---

## How it works

Each uploaded document is split into ~1 000-character chunks, each chunk is embedded with `text-embedding-3-small` and stored in a local **ChromaDB** collection. At query time the question is embedded into the same space, the top-4 chunks are retrieved by cosine similarity, and they're fed to **GPT-4o** with a strict "answer only from the provided context" system prompt. The model replies with inline `[1] [2]` citations pointing at the retrieved chunks.

If you want the long-form walkthrough — every file, every flow, every diagram — see [`docs/architecture.md`](docs/architecture.md).

## Features

- Upload **PDF, DOCX, TXT, MD, JSON** (20 MB cap per file)
- **Grounded answers** — model is instructed to say "I don't know based on the provided documents" rather than hallucinate
- **Inline citations** rendered as cyan pills that point at the exact chunks used
- **Sources panel** showing which documents are currently in scope
- **Token-usage meter** with a soft 100 k cap so you can see your spend
- **New Session** button that wipes both the chat and the vector store
- `X-Auth` header gate on `/ingest` and `/reset` so a public demo can't burn your OpenAI quota
- Single-page React 19 UI with framer-motion transitions

## Tech stack

| Layer | Stack |
|---|---|
| Backend | Python 3.14, FastAPI, LangChain (`langchain-community`, `langchain-openai`, `langchain-chroma`) |
| Vector store | ChromaDB (local, persisted to `vector_store/`) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | OpenAI `gpt-4o` (temperature 0) |
| Frontend | React 19 + TypeScript + Vite + TailwindCSS v4 + framer-motion + lucide-react |
| Packaging | Dockerfile + docker-compose for one-command runs |

## Screenshots

![Chat interface](docs/screenshots/chat-interface.png)

![Sources panel](docs/screenshots/sidebar.png)

![Example conversation](docs/screenshots/example-conversation.png)

## Quickstart (local)

```powershell
# 1. Clone and enter the repo
git clone https://github.com/ashutoshsati/docwhisperer.git
cd docwhisperer

# 2. Backend setup
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Configure secrets
copy .env.example .env
#   then edit .env and set:
#     OPENAI_API_KEY=sk-...
#     APP_TOKEN=any-long-random-string   (optional; gates /ingest and /reset)

# 4. Frontend setup
cd Frontend
npm install
cd ..
```

Two terminals from here on:

```powershell
# Terminal 1 — backend on :8000
.\.venv\Scripts\python.exe -m uvicorn Backend.main:app --reload --port 8000

# Terminal 2 — frontend on :3000
cd Frontend
npm run dev
```

Open <http://localhost:3000>.

## Docker

```bash
docker compose up --build
```

This builds the React bundle, copies it into the FastAPI image, and serves both from a single container on port 8000.

## API

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/healthz` | — | — | `{ "status": "ok" }` |
| `POST` | `/ingest` | `X-Auth` | `multipart/form-data` with `file` | `{ filename, raw_documents, chunks }` |
| `POST` | `/query` | — | `{ "query": "..." }` | `{ answer, sources, usage }` |
| `POST` | `/reset` | `X-Auth` | — | `{ "ok": true }` |

Errors come back as `{ "detail": "..." }` with the appropriate 4xx/5xx code.

## Project layout

```
docwhisperer/
├── Backend/
│   ├── main.py      # FastAPI app + routes
│   ├── ingest.py    # load -> chunk -> embed -> store
│   └── query.py     # embed -> search -> prompt -> answer
├── Frontend/
│   ├── App.tsx      # the entire SPA in one file
│   ├── main.tsx
│   ├── index.css
│   └── vite.config.ts
├── docs/
│   └── architecture.md   # deep-dive: every file, every flow, every diagram
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## Configuration knobs

The most useful constants to tune (defaults shown):

| Constant | Default | File | Effect |
|---|---|---|---|
| `CHUNK_SIZE` | `1000` | `Backend/ingest.py` | Chars per chunk |
| `CHUNK_OVERLAP` | `200` | `Backend/ingest.py` | Overlap between adjacent chunks |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | both backend modules | Bump to `-3-large` for better recall |
| `CHAT_MODEL` | `gpt-4o` | `Backend/query.py` | Swap to `gpt-4o-mini` for ~15× cheaper dev |
| `TOP_K` | `4` | `Backend/query.py` | How many chunks to retrieve per question |
| `MAX_UPLOAD_BYTES` | `20 MB` | `Backend/main.py` | Upload size limit |

## Deploying to Hugging Face Spaces

This repo doubles as a Hugging Face Space (Docker SDK). The YAML frontmatter at the top of this README is the Space's manifest. To deploy:

1. Push to `https://huggingface.co/spaces/<your-user>/<your-space>`
2. In the Space's **Settings → Variables and secrets**, add `OPENAI_API_KEY` and (optionally) `APP_TOKEN`
3. The Space builds via `Dockerfile` and serves on port 7860

## License

MIT — see [LICENSE](LICENSE).
