# BiocBot Project Phases Summary

## Phase 0 – Project Setup and Planning
> Goal: Set up project infrastructure, define architecture, and create initial project documentation.

- Repository and development environment setup
- Architecture planning and system design
- UI/UX design and wireframing
- Initial frontend and backend prototypes

## Phase 1 – Authentication and Basic Setup
> Goal: Set up the basic application structure, authentication flow, and core interfaces.

- Project structure and Express server setup
- CWL authentication with mock SAML flow
- Basic student and instructor interfaces
- MongoDB configuration and schema design

## Phase 2 – Content Processing Pipeline
> Goal: Implement the content processing pipeline for instructors to upload, process, and manage course materials.

- File, URL, and text input interfaces
- Document parsing with UBC GenAI Toolkit
- Content chunking and vector embeddings using Qdrant
- Learning objectives management

## Phase 3 – Chat Functionality and Modes
> Goal: Implement the chat interface with different interaction modes (protégé and tutor) and calibration quiz functionality.

- Chat UI and backend implementation
- Calibration quiz generation and interface
- Protégé mode (student as learner)
- Tutor mode (student as teacher)

## Phase 4 – Instructor Tools and Analytics
> Goal: Implement instructor dashboard with analytics, flags management, and content management tools.

- Dashboard enhancement with key metrics
- Flag management system and daily digest
- Content publishing and re-indexing tools
- Agent implementation for summarization and moderation
- Analytics data collection and reporting

## Phase 5 – Security, Accessibility, and Deployment
> Goal: Ensure the application meets security, privacy, and accessibility standards, and prepare for deployment.

- Security hardening and data protection
- WCAG compliance and responsive design
- User and performance testing
- Deployment preparation and documentation
- Stretch goals implementation 