# Phase 1 – Authentication and Basic Setup

> Goal: Set up the basic application structure, authentication flow, and core interfaces.

## Checklist

### Project Setup
- [ ] **1.1 Project Structure**
    - [ ] Create `public/`, `public/styles/`, `public/scripts/`, and `src/` directories
    - [ ] Set up Express.js server in `src/server.js`
    - [ ] Create basic HTML templates in `public/`

### Authentication
- [ ] **2.1 CWL Authentication**
    - [ ] Implement mock SAML flow for local development
    - [ ] Store session in MongoDB
    - [ ] Issue JWT to frontend after login
    - [ ] Handle role-based access (student, TA, instructor, admin)

### Core Interfaces
- [ ] **3.1 Student Interface**
    - [ ] Create basic chat interface HTML/CSS structure
    - [ ] Implement onboarding modal for first-time users
    - [ ] Add terms and conditions with personal information warning
    - [ ] Create mode toggle UI element (protégé/tutor)

- [ ] **3.2 Instructor Interface**
    - [ ] Create dashboard layout with sidebar navigation
    - [ ] Implement course selection dropdown
    - [ ] Create onboarding flow for new course setup
    - [ ] Add unit/accordion panels for course materials

### Database Setup
- [ ] **4.1 MongoDB Configuration**
    - [ ] Set up MongoDB connection
    - [ ] Create schemas for users, courses, sessions, and materials
    - [ ] Implement basic CRUD operations for each schema

- [ ] **4.2 Qdrant Setup**
    - [ ] Install and configure Qdrant for vector storage
    - [ ] Set up connection to Qdrant from Node.js
    - [ ] Create initial collection structure for embeddings
    - [ ] Implement basic vector operations (insert, search)

### Basic Frontend Logic
- [ ] **5.1 Navigation**
    - [ ] Implement vanilla JS router for single-page application
    - [ ] Create navigation between dashboard, chat, and settings
    - [ ] Add responsive design for mobile and desktop 