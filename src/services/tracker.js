/**
 * Tracker Service
 * Analyzes student messages to detect struggle and identify topics.
 */

class TrackerService {
    constructor(llmService) {
        this.llmService = llmService;
    }

    /**
     * Analyze a student message for struggle and topic
     * @param {string} message - The student's message
     * @param {string} courseId - Course context
     * @param {string} unitName - Unit context
     * @param {Array<string>} approvedTopics - Instructor-approved per-course topics
     * @returns {Promise<Object>} Analysis result
     */
    async analyzeMessage(message, courseId, unitName, approvedTopics = []) {
        try {
            console.log(`🕵️ [TRACKER_DEBUG] LLM Analyze Request for: "${message}"`);
            const cleanApprovedTopics = Array.isArray(approvedTopics)
                ? approvedTopics.filter(topic => typeof topic === 'string' && topic.trim())
                : [];

            const prompt = `
You are analyzing student struggle in a biochemistry chat.

Student Message: "${message}"
Context: Course ${courseId}, Unit ${unitName}
Approved Course Topics:
${cleanApprovedTopics.length > 0 ? cleanApprovedTopics.map((topic, index) => `${index + 1}. ${topic}`).join('\n') : 'No approved topics configured'}

Tasks:
1. Detect if the student is struggling (confusion, frustration, or explicit lack of understanding).
2. Identify the raw topic from the student's language.
3. Map that raw topic to the closest approved topic using semantic similarity.
4. If no approved topic is a reasonable semantic match, use "unmapped".
5. Return JSON only.

Output JSON schema:
{
  "isStruggling": boolean,
  "rawTopic": "string",
  "mappedTopic": "string (must be one approved topic or 'unmapped')",
  "matchConfidence": "number 0-1",
  "reason": "string"
}

Rules:
- Never invent a mapped topic outside the approved list.
- If semantic match confidence is below 0.55, use "unmapped".
- If message is not a struggle, mappedTopic should still be "unmapped" unless there is a clear mapped struggle topic.
            `;

            const response = await this.llmService.sendMessage(prompt, {
                temperature: 0.1,
                maxTokens: 220,
                systemPrompt: "You are an empathetic analyst detecting student struggle. Output JSON only."
            });

            console.log(`🕵️ [TRACKER_DEBUG] LLM Raw Response:`, response.content);

            const content = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(content);
            
            console.log(`🕵️ [TRACKER_DEBUG] Parsed Result:`, result);

            const mappedTopic = typeof result.mappedTopic === 'string' ? result.mappedTopic.trim() : '';
            const approvedTopicMap = new Map(
                cleanApprovedTopics.map((topic) => [topic.toLowerCase(), topic])
            );
            const normalizedMappedTopic = mappedTopic.toLowerCase();
            const matchedApprovedTopic = approvedTopicMap.get(normalizedMappedTopic) || '';
            const matchConfidence = typeof result.matchConfidence === 'number' ? result.matchConfidence : 0;
            const isMapped = !!matchedApprovedTopic && matchConfidence >= 0.55;

            return {
                topic: isMapped ? matchedApprovedTopic : 'unmapped',
                rawTopic: result.rawTopic || '',
                isMapped,
                matchConfidence,
                isStruggling: result.isStruggling || false,
                reason: result.reason || ''
            };

        } catch (error) {
            console.error('❌ [TRACKER] Error analyzing message:', error);
            // Fail gracefully - assume no struggle
            return { isStruggling: false, topic: 'unmapped', isMapped: false, reason: 'Error' };
        }
    }
}

module.exports = TrackerService;
