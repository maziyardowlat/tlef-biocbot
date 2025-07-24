# Phase 3 – Chat Functionality and Modes

> Goal: Implement the chat interface with different interaction modes (protégé and tutor) and calibration quiz functionality.

## Checklist

### Chat Interface
- [ ] **1.1 Chat UI**
    - [ ] Create message bubbles with distinct styling for bot and student
    - [ ] Implement text input field with send button
    - [ ] Add persistent disclaimer about personal information
    - [ ] Create three-dot menu for message reporting

- [ ] **1.2 Chat Backend**
    - [ ] Create chat endpoint to handle messages
    - [ ] Implement session management for conversations
    - [ ] Store chat history in MongoDB
    - [ ] Add message validation and sanitization

### Calibration Quiz
- [ ] **2.1 Quiz Generation**
    - [ ] Create interface for instructors to add probe questions
    - [ ] Implement auto-generation of questions from course materials
    - [ ] Store questions per unit in MongoDB
    - [ ] Add validation for generated questions

- [ ] **2.2 Quiz Interface**
    - [ ] Create quiz UI with learning objectives list
    - [ ] Implement question display and answer input
    - [ ] Add scoring mechanism based on instructor settings
    - [ ] Create mode selection based on quiz results

### Protégé Mode (Student as Learner)
- [ ] **3.1 Teacher Bot**
    - [ ] Implement RAG for generating responses from course materials
    - [ ] Create logic for bot to lead conversations
    - [ ] Add out-of-scope question detection
    - [ ] Implement session summary generation

- [ ] **3.2 Question Generation**
    - [ ] Create question generation based on learning objectives
    - [ ] Implement different question types (concept, calculation)
    - [ ] Add follow-up question logic
    - [ ] Ensure questions stay within course material scope

### Tutor Mode (Student as Teacher)
- [ ] **4.1 Student Bot**
    - [ ] Implement RAG for generating student-like questions
    - [ ] Create logic for bot to ask questions based on learning objectives
    - [ ] Add feedback generation for student answers
    - [ ] Implement session summary with areas of focus

- [ ] **4.2 Advanced Question Types**
    - [ ] Add support for LaTeX in calculation questions
    - [ ] Implement prompts for drawing questions
    - [ ] Create summary exercise generation
    - [ ] Add question formulation prompts 