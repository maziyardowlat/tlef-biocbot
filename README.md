# BiocBot - AI-Powered Study Assistant

BiocBot is an AI-powered study assistant platform that enables students to interact with course material in a chat-based format. Instructors can upload documents (PDFs, DOCX, or TXT), which are automatically parsed, chunked, and embedded into a vector database (Qdrant) for semantic search. When a student asks a question, the system retrieves relevant chunks and generates a response grounded in course content.

## 🚀 Features

- **Document Management**: Upload and organize course materials
- **Vector Search**: Semantic search across documents using Qdrant
- **AI Chat Interface**: Student interaction with course content
- **Per-Course Retrieval Mode**: Instructor-controlled additive vs single-unit retrieval for chat
- **Assessment Questions**: Create and manage course assessments
- **Course Structure**: Organize content by units/lectures
- **User Management**: Separate interfaces for instructors and students

## 🏗️ Architecture

BiocBot follows a split architecture with a public frontend and a private backend, adhering to clear separation of concerns for maintainability and security.

### Tech Stack

- **Frontend**: HTML + Vanilla JS (no frameworks), styled via separate CSS files
- **Backend**: Node.js (Express), built with modular architecture
- **Database**: MongoDB (for documents, user sessions, analytics)
- **Vector Database**: Qdrant for semantic search and similarity retrieval
- **Embeddings**: Ollama with nomic-embed-text model
- **Document Processing**: UBC GenAI Toolkit modules

## 🛠️ Setup & Installation

### Prerequisites

- Node.js v18.x or higher
- MongoDB instance
- Qdrant vector database (Docker recommended)
- Ollama with nomic-embed-text model

### 1. Clone and Install

```bash
git clone <repository-url>
cd tlef-biocbot
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```bash
# MongoDB Connection
MONGO_URI=mongodb://localhost:27017/biocbot

# Server Port
TLEF_BIOCBOT_PORT=8080

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=super-secret-dev-key

# Embeddings Provider Configuration
EMBEDDING_PROVIDER=ubc-genai-toolkit-llm

# LLM Provider Settings (for Embeddings)
LLM_PROVIDER=ollama
LLM_API_KEY=nokey
LLM_ENDPOINT=http://localhost:11434
LLM_EMBEDDING_MODEL=nomic-embed-text
LLM_DEFAULT_MODEL=llama3.1
```

### 3. Start Services

#### Start Qdrant (Docker)
```bash
docker run -p 6333:6333 qdrant/qdrant
```

#### Start Ollama with nomic-embed-text
```bash
ollama pull nomic-embed-text
ollama serve
```

#### Start BiocBot
```bash
npm run dev
```

## 🔍 Qdrant Integration

BiocBot now includes advanced vector search capabilities through Qdrant integration:

### Features
- **Automatic Document Processing**: Documents are automatically chunked, embedded, and stored
- **Semantic Search**: Find relevant content using natural language queries
- **Course-Aware Search**: Filter results by course and lecture
- **Real-time Indexing**: New documents are immediately searchable

### API Endpoints

- `GET /api/qdrant/status` - Check Qdrant service status
- `POST /api/qdrant/process-document` - Process and store document
- `POST /api/qdrant/search` - Semantic search across documents
- `DELETE /api/qdrant/document/:id` - Delete document chunks
- `GET /api/qdrant/collection-stats` - Get collection statistics

### Testing the Integration

Visit `/qdrant-test` to test the Qdrant functionality:
- Process test documents
- Perform semantic searches
- View collection statistics

## 📚 Usage

### For Instructors

1. **Access**: Navigate to `/instructor`
2. **Onboarding**: Complete course setup
3. **Upload Documents**: Add course materials to units
4. **Create Questions**: Build assessments for students
5. **Publish Units**: Make content available to students
6. **Retrieval Mode**: On the course Home page, toggle “Use additive retrieval” to allow chat to include earlier published units in addition to the selected unit. When off, chat uses only the selected unit.

### For Students

1. **Access**: Navigate to `/student`
2. **Course Selection**: Choose your course
3. **Assessment**: Complete calibration questions
4. **Chat Interface**: Select a unit, then ask questions about course material. Chat retrieval respects the course’s retrieval mode.
5. **Semantic Search**: Find relevant content using natural language

## 🔧 Development

### Project Structure
```
tlef-biocbot/
├── public/                 # Frontend assets
│   ├── instructor/        # Instructor interface
│   ├── student/          # Student interface
│   └── qdrant-test.html  # Qdrant testing page
├── src/                   # Backend source
│   ├── models/           # Data models
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   └── server.js         # Main server file
└── documents/            # Course documentation
```

### Key Components

- **QdrantService**: Handles vector database operations
- **Document Processing**: Automatic chunking and embedding
- **Semantic Search**: Vector similarity search
- **Course Management**: Structured content organization

## 🚧 Current Status

- ✅ **Phase 1**: Backend pipeline with Qdrant integration
- ✅ **Document Upload**: File and text document support
- ✅ **Vector Search**: Semantic document retrieval
- 🔄 **Assessment System**: Question creation and management
- 🔄 **Student Interface**: Chat-based learning experience

## 🤝 Contributing

This project follows clean architecture principles optimized for clarity, maintainability, and junior developer readability. All code should be:

- **Modular**: Single responsibility functions and classes
- **Documented**: Comprehensive docblocks and inline comments
- **Accessible**: Clear variable names and logical flow
- **Secure**: Input validation and error handling
- New updates as well
## 📄 License

ISC License
