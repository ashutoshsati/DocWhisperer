# Design: "New Session" reset

## Goal

Clicking the **New Session** button in the left sidebar should fully reset the chatbot:

- Delete every chunk/embedding the user has ingested into ChromaDB.
- Clear the chat conversation in the UI.
- Clear the "Sources in Use" panel in the UI.
- Show a confirmation modal first so a stray click can't destroy the user's data.

After the reset the app is identical in state to a freshly-launched session: empty store, no chat history, no sources, ready for a new upload.

## Non-goals

- Per-user / per-browser session isolation. This is a single-user dev app; one global vector store is fine.
- Preserving "previous chats" as a sidebar history (the way ChatGPT does). Reset means everything goes.
- Wiping the OpenAI key, the `.env` file, or the running server process.
- Deleting the `vector_store/` directory itself — only its contents.
- Cross-request locking (e.g. blocking ingest while a reset is in flight). The race window is tiny in single-user use; one stale chunk surviving a reset is acceptable.

## Backend

### New endpoint

```
POST /reset
Request body: (none)
Response: 200 {"ok": true}
```

Implementation lives in `Backend/main.py`. It opens the existing Chroma collection (same parameters as `query.get_vectorstore()` — same persist dir, collection name, embedding function) and calls `.delete_collection()` on it. The next `/ingest` call constructs a new `Chroma(...)` which lazily re-creates the collection inside the same persist directory.

### Why `delete_collection()` and not `rm -rf vector_store/`

Chroma keeps a SQLite connection open for the lifetime of the uvicorn process. On Windows, deleting the on-disk SQLite file while it is open fails with an OS-level file lock. `delete_collection()` is the supported API; it releases the rows atomically and survives concurrent readers.

### Error handling

- `delete_collection()` raises if the named collection doesn't exist (e.g. fresh install, never ingested). Catch this case and treat it as success — the post-condition ("collection is empty") is already met.
- Other unexpected exceptions: 500 with the exception message in `detail`, same pattern as the existing endpoints.

## Frontend

All changes live in `Frontend/App.tsx`.

### State additions

```ts
const [showResetConfirm, setShowResetConfirm] = useState(false);
const [isResetting, setIsResetting] = useState(false);
```

### Wire up the existing button

The "New Session" button in the left sidebar gets `onClick={() => setShowResetConfirm(true)}`. No styling changes.

### Confirmation modal

A small overlay rendered conditionally when `showResetConfirm` is true. Reuses existing utility classes — `glass-panel`, `glow-cyan`, `text-brand-cyan`, the same backdrop-blur style as the input area — so it visually belongs to the rest of the UI. Uses `framer-motion` for the fade/scale entry, since `motion/react` is already imported.

Contents:

- Title: "Start a new session?"
- Body: "This will permanently delete all uploaded documents and clear the chat. This cannot be undone."
- Two buttons: **Cancel** (subtle, dismisses the modal) and **Reset Session** (cyan, destructive primary action).

The modal closes on:
- Cancel button click
- Successful reset (auto-close)
- Click outside the modal panel (backdrop click)

### Reset handler

```
async function handleReset() {
  setIsResetting(true);
  setError(null);
  try {
    const res = await fetch(`${API_URL}/reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    setChatMessages([]);
    setSources([]);
    setShowResetConfirm(false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    setError(`Reset failed: ${msg}. Is the FastAPI backend running at ${API_URL}?`);
    setShowResetConfirm(false);
  } finally {
    setIsResetting(false);
  }
}
```

The modal's "Reset Session" button calls `handleReset` and is disabled while `isResetting` is true. Failure leaves chat + sources intact and surfaces the error in the existing red banner above the input — same pattern as `/ingest` and `/query` failures.

## Data flow summary

```
User clicks "New Session"
  → setShowResetConfirm(true)
  → modal renders
User clicks "Reset Session" in modal
  → handleReset()
  → POST /reset
       → main.py opens Chroma collection
       → collection.delete_collection()
       → return {"ok": true}
  → frontend clears chatMessages, sources
  → modal closes
```

## What gets wiped vs preserved

| State | Wiped | Why |
|---|---|---|
| ChromaDB chunks/embeddings | Yes | The point of the feature |
| Frontend chat messages | Yes | Match backend reality |
| Frontend "Sources in Use" panel | Yes | Match backend reality |
| `vector_store/` directory itself | No | Chroma re-creates the collection inside it on next ingest |
| `.env`, OpenAI key, server process | No | Out of scope |
| Open uvicorn / Vite processes | No | Reset is a per-session action, not a redeploy |

## Testing

Manual end-to-end on a real browser session:

1. Upload a doc, ask a question, verify chunks exist (log shows `retrieved N chunks`).
2. Click "New Session" → modal appears.
3. Click Cancel → modal closes, chat + sources unchanged.
4. Click "New Session" → click "Reset Session" → modal closes, chat empty, sources empty.
5. Ask a question → verify the empty-store path fires (`"No documents have been ingested yet — upload one first using POST /ingest."`).
6. Re-upload the same doc → verify ingestion succeeds (this exercises the "collection re-created on first add" path).
7. Stop the backend, click "New Session" → "Reset Session" → verify the red error banner appears with a useful message and chat/sources are NOT cleared.

## Files touched

- `Backend/main.py` — add `POST /reset` endpoint, ~15 lines.
- `Frontend/App.tsx` — wire button, add state, add modal, add handler, ~40 lines.

No new files, no new dependencies.
