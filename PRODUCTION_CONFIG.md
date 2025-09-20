# Production Configuration Guide

## Environment Variables Required

Create a `.env` file in the project root with the following variables:

```bash
# MongoDB Configuration
MONGO_URI=mongodb://mongoadmin:secret@127.0.0.1:27017/biocbot-prod?authSource=admin

# Server Configuration
TLEF_BIOCBOT_PORT=8080
NODE_ENV=production

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=super-secret-dev-key

# LLM Provider Configuration
# Choose one: ollama, openai, or ubc-llm-sandbox
LLM_PROVIDER=ollama

# Ollama Configuration (for production)
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3.1
LLM_API_KEY=nokey
LLM_ENDPOINT=http://localhost:11434
LLM_EMBEDDING_MODEL=nomic-embed-text

# Chunking Configuration
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
CHUNK_MIN=100

# Embedding Provider
EMBEDDING_PROVIDER=ubc-genai-toolkit-llm
```

## Common Production Issues

### 1. Missing Environment Variables
The most common cause of 500 errors is missing or incorrect environment variables. Make sure all required variables are set.

### 2. Ollama Service Not Running
Ensure Ollama is running and accessible at the configured endpoint:
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama if not running
ollama serve
```

### 3. Qdrant Service Not Running
Ensure Qdrant is running and accessible:
```bash
# Check if Qdrant is running
curl http://localhost:6333/collections

# Start Qdrant if not running
docker run -p 6333:6333 qdrant/qdrant
```

### 4. MongoDB Connection Issues
Ensure MongoDB is running and accessible:
```bash
# Check MongoDB connection
mongosh "mongodb://mongoadmin:secret@127.0.0.1:27017/biocbot-prod?authSource=admin"
```

## Debugging Steps

1. Check the server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test each service individually:
   - Test MongoDB: `curl http://localhost:8080/api/health`
   - Test Qdrant: `curl http://localhost:8080/test-qdrant`
   - Test LLM: `curl -X POST http://localhost:8080/api/chat/test`

## Service Dependencies

The application requires these services to be running:
1. MongoDB (port 27017)
2. Qdrant (port 6333)
3. Ollama (port 11434)

Make sure all services are running before starting the application.
