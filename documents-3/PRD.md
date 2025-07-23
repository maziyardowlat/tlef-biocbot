# BiocBot — Product Requirements Document

## 1. Why BiocBot Exists
BiocBot is a 24/7 chatbot learning tool designed to be piloted in BIOC 202. It is built around the protégé–instructor dynamic, where students deepen their understanding by actively asking questions, thinking aloud, and teaching concepts back. BiocBot uses AI to deliver helpful, trustworthy responses by drawing only from instructor-approved course material.

## 2. Key Benefits 
- Students get quick, trustworthy help, with clear links back to official course materials
- "Teach-back" mode helps students catch misunderstandings early by explaining concepts in their own words
- Expands the reach of the current study-buddy program by making it accessible to all students, 24/7

## 3. Student Interface

### 3.1 Sign In
- Authentication through CWL (UBC SSO) or Canvas integration
- Secure session management

### 3.2 Onboarding
- Terms of use agreement
- Introduction to the bot and its capabilities
- Privacy guidelines and warnings

### 3.3 Chat Interface
- Distinct message styling for bot and student
- Message flagging functionality
- Text input field with appropriate validation
- Mode toggle between protégé and tutor modes
- Citation display with links to source material

### 3.4 Student Dashboard
- Session history and summaries
- Usage statistics
- Upcoming unit information
- Help and tutorial resources

## 4. Modes of Interaction

### 4.1 Calibration Quiz
- Learning objectives assessment
- Probe questions to determine appropriate mode
- Instructor-provided or auto-generated questions
- Mode selection based on performance

### 4.2 Student as Protégé Mode
- Bot acts as teacher, leading the conversation
- Concept explanation and question sequences
- Out-of-scope question handling
- Session summaries and learning focus areas

### 4.3 Student as Tutor Mode
- Student leads as teacher, explaining concepts
- Bot asks questions based on learning objectives
- Various question types (concept, calculation, drawing)
- Follow-up questions and feedback

## 5. Instructor Interface

### 5.1 Sign In
- Authentication through CWL or Canvas
- Course selection from associated courses

### 5.2 Onboarding
- Course setup guidance
- Unit creation and organization
- Initial material upload

### 5.3 Instructor Dashboard
- Sidebar navigation with course and unit selection
- Tabs for different functionality areas
- Flag notifications and alerts
- Export functionality

### 5.4 Course Materials Management
- Unit-based accordion panels
- Learning objectives management
- Multiple content upload methods (file, URL, text)
- Content verification and parsing

### 5.5 Settings & Notifications
- Calibration quiz configuration
- Flag notification preferences
- System configuration options

### 5.6 Content Management
- Re-indexing capabilities
- Duplicate detection
- Content removal and replacement

### 5.7 Flag Management
- Flag review queue
- Daily digest of flagged content
- Resolution actions

### 5.8 Analytics
- Usage statistics
- Export functionality
- Performance metrics

## 6. Content Processing & Retrieval

### 6.1 Document Processing Pipeline
- File upload and conversion
- Text extraction and cleaning
- Chunking for effective retrieval
- Vector embedding generation
- Search functionality

### 6.2 Intelligent Agents
- Summary generation agent
- Content moderation agent
- Personal information detection agent

## 7. Security and Privacy

### 7.1 Content Moderation
- Violation handling and warnings
- Instructor notification system
- User suspension capabilities

### 7.2 Data Protection
- Compliance with UBC data policies
- Personal information protection
- Secure data storage and transmission

## 8. Roles and Permissions

- **Student**: Chat access, mode selection, flagging capability
- **Teaching Assistant**: Content upload, flag resolution
- **Instructor**: Full dashboard access, settings management
- **Admin**: System configuration, role management

## 9. Accessibility and Standards

- WCAG 2.1 AA compliance
- Responsive design
- Screen reader compatibility
- High contrast and text size options 