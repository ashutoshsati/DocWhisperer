# Stage 1: build the React SPA into static files
FROM node:22-slim AS frontend
WORKDIR /fe
COPY Frontend/package.json Frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY Frontend/ ./
# Empty VITE_API_URL -> frontend uses relative URLs (/query, /ingest, /reset).
# Same-origin requests -> no CORS, works behind any host or IP.
ENV VITE_API_URL=""
# APP_TOKEN comes in as a build arg (HF Spaces "Variables" are passed as build
# args; locally pass via --build-arg APP_TOKEN=...). Empty default -> auth off.
ARG APP_TOKEN=""
ENV VITE_APP_TOKEN=$APP_TOKEN
RUN npm run build

# Stage 2: Python backend, with the built SPA bundled in
FROM python:3.13-slim
WORKDIR /app

# System libs that some Python wheels link against (sqlite for chromadb is
# included with python:3.13-slim, but onnxruntime/pypdf occasionally need libgomp).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first so this layer is cached when only source changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source and the SPA bundle from stage 1
COPY Backend/ ./Backend/
COPY --from=frontend /fe/dist ./Frontend/dist

# Run as non-root UID 1000 ("user") — required by Hugging Face Spaces and
# good practice elsewhere. Give that user ownership of /app so vector_store/
# is writable at runtime.
RUN useradd -m -u 1000 user && chown -R user:user /app
USER user

# Listen on 7860 inside the container — HF Spaces' Docker SDK expects this.
# For local docker-compose we publish host:80 -> container:7860.
EXPOSE 7860
CMD ["uvicorn", "Backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
