# Implementation Plan - Tracker Agent

We will implement a separate "Tracker Agent" (running via the `TrackerService`) that analyzes student messages to detect topics and potential struggles. This will be integrated into the chat flow to intervene (modify the main prompt) when a student is struggling with a topic repeatedly.

## User Review Required
**None**. The current plan uses an asynchronous execution model to avoid user-facing latency.

## Proposed Changes

### [Backend] Tracker Service
#### [NEW] [src/services/tracker.js](file:///Users/maziyardowlat/Desktop/BICBOTAug24/tlef-biocbot/src/services/tracker.js)
-   Create a new service class `TrackerService`.
-   Implement `analyzeMessage(message, history)`:
    -   **CRITICAL**: This MUST return a valid JSON object.
    -   Use `response_format: { type: "json_object" }` for providers that support it (e.g., OpenAI, some Ollama models).
    -   **Tracker System Prompt**:
        > "You are a pedagogical supervisor monitoring a conversation between a student and an AI tutor. Your goal is to analyze the student's messages to track their learning progress and identify struggles.
        >
        > Analyze the Student's latest message (and recent context) to extract:
        > 1.  **Topic**: The specific academic concept they are discussing.
        > 2.  **Struggle**: Set to `true` ONLY if the student explicitly expresses confusion, inability to understand, frustration, or repeatedly gets the concept wrong. Questions for clarification are NOT necessarily struggles.
        > 3.  **Reason**: A very brief explanation of why you flagged it as a struggle."
    -   **JSON Schema**:
        ```json
        {
          "topic": "string (the main topic of the message)",
          "isStruggling": "boolean (true if student expresses confusion or repeated failure)",
          "reason": "string (brief explanation)"
        }
        ```
    -   Returns the parsed JSON object. If parsing fails, logs error and returns default "no struggle" object.

### [Backend] Chat Route
#### [MODIFY] [src/routes/chat.js](file:///Users/maziyardowlat/Desktop/BICBOTAug24/tlef-biocbot/src/routes/chat.js)
-   Import `TrackerService` and user model functions.
-   In the `POST /` handler:
    1.  **Retrieve Existing Struggles**: Fetch the user's *current* struggle counts from the DB (fast read).
    2.  **Prepare Main Agent (Job A)**:
        -   Check if *existing* `struggleCount > 3` for any topic.
        -   **Intervention**: If yes, append the intervention/protege prompt to the pending LLM call.
    3.  **Spawn Tracker Agent (Job B)**:
        -   **FIRE AND FORGET**: Trigger `TrackerService.analyzeMessage` asynchronously. Do NOT `await` this before processing the main response.
        -   Tracker analyzes the message in the background.
        -   Tracker updates the DB `struggleCount` for the *next* turn.
    4.  **Execute Main Agent**: Proceed with RAG and Tutor LLM generation immediately. Return response to student.
    
    *Note: This ensures near-zero added latency. The intervention will trigger on the turn *after* the threshold is crossed, which is acceptable for a cumulative counter.*

### [Backend] User Model
#### [MODIFY] [src/models/User.js](file:///Users/maziyardowlat/Desktop/BICBOTAug24/tlef-biocbot/src/models/User.js)
-   Update `createUser` to initialize an empty `struggles` object.
-   **GLOBAL PERSISTENCE**: The `struggles` field will be stored on the User document, ensuring counts persist across *all* chat sessions for that student.
-   Add `updateStruggleCount(db, userId, topic)`: Increments the global counter for a specific topic.
-   Add `getUserStruggles(db, userId)`: Retrieves the current global struggle counts.

### [Backend] Chat Route
#### [MODIFY] [src/routes/chat.js](file:///Users/maziyardowlat/Desktop/BICBOTAug24/tlef-biocbot/src/routes/chat.js)
-   Import `TrackerService` and user model functions.
-   In the `POST /` handler:
    1.  Call `TrackerService.analyzeMessage` (in parallel with Qdrant search if possible, or before).
    2.  If struggle detected, call `updateStruggleCount`.
    3.  Check if `struggleCount > 3` for the current topic.
    4.  If yes, append an instruction to the `messageToSend` (e.g., "The student is struggling with [Topic]. Please provide a brief summary...").

## Verification Plan

### Automated Tests
-   We can create a manual test script that:
    1.  Calls the `TrackerService` directly with valid/invalid inputs to verify JSON output.
    2.  Simulates a chat flow by calling the API endpoint multiple times to verify the counter increments.

### Manual Verification
1.  **Tracker Logic**: Send a message like "I don't understand photosynthesis" -> Verify logs show "Topic: Photosynthesis", "Struggle: True".
2.  **DB Update**: specific check in MongoDB (or logs) that `struggles.photosynthesis` increments.
3.  **Intervention**: Repeat the struggle message 4 times. On the 4th/5th time, verify the Main LLM prompt contains the intervention instruction (via logs).
