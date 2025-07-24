# Phase 2 – Content Processing Pipeline

> Goal: Implement the content processing pipeline for instructors to upload, process, and manage course materials.

## Checklist

### Content Upload
- [ ] **1.1 File Upload Interface**
    - [ ] Create drag-and-drop upload zone in each unit panel
    - [ ] Implement file type validation (PDF, DOCX, TXT)
    - [ ] Add progress indicators for uploads
    - [ ] Display error messages for failed uploads

- [ ] **1.2 URL and Text Input**
    - [ ] Add input field for public URLs
    - [ ] Create text area for direct text input
    - [ ] Implement URL validation and allowlisting
    - [ ] Add verification prompt for URL content

### Document Processing
- [ ] **2.1 Document Parsing**
    - [ ] Integrate UBC GenAI Toolkit for document parsing
    - [ ] Extract text content from uploaded files
    - [ ] Handle parsing errors and notify instructors
    - [ ] Store raw text in MongoDB

- [ ] **2.2 Content Chunking**
    - [ ] Implement text chunking for effective retrieval
    - [ ] Store chunks with metadata (source, unit, etc.)
    - [ ] Create indexing system for content retrieval

### Vector Embeddings
- [ ] **3.1 Embedding Generation**
    - [ ] Set up embedding pipeline using UBC GenAI Toolkit
    - [ ] Generate embeddings for all content chunks
    - [ ] Store embeddings in Qdrant vector database
    - [ ] Implement error handling for embedding failures

### Learning Objectives
- [ ] **4.1 Learning Objectives Management**
    - [ ] Create interface for adding/editing learning objectives
    - [ ] Store learning objectives per unit
    - [ ] Link objectives to course materials
    - [ ] Implement validation for learning objectives

### Content Management
- [ ] **5.1 Content Verification**
    - [ ] Create verification interface for parsed content
    - [ ] Allow instructors to edit parsed content
    - [ ] Implement re-indexing for updated content
    - [ ] Add duplicate detection for uploaded materials 