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
     * @returns {Promise<Object>} Analysis result { isStruggling, topic, reason }
     */
    async analyzeMessage(message, courseId, unitName) {
        try {
            console.log(`🕵️ [TRACKER_DEBUG] LLM Analyze Request for: "${message}"`);
            const prompt = `
            Analyze the following student message from a Biochemistry course chat.
            Student Message: "${message}"
            Context: Course ${courseId}, Unit ${unitName}

            Task:
            1. Identify if the student is expressing confusion, frustration, or a lack of understanding ("struggle").
            2. Identify the specific biochemical topic they are struggling with.
            3. Return JSON ONLY.

            JSON Schema:
            {
                "topic": "string (the specific biochemical topic, e.g., 'Enzyme Kinetics', 'Protein Structure')",
                "isStruggling": boolean,
                "reason": "string (brief explanation)"
            }

            Examples:
            - "I don't understand chemical bonds" -> {"topic": "Chemical Bonds", "isStruggling": true, "reason": "Explicit confusion"}
            - "What is the answer?" -> {"topic": "General", "isStruggling": false, "reason": "Simple inquiry"}
            - "This is so hard, I'm lost" -> {"topic": "Current Unit", "isStruggling": true, "reason": "Frustration expressed"}
            `;

            const response = await this.llmService.sendMessage(prompt, {
                temperature: 0.1,
                maxTokens: 150,
                systemPrompt: "You are an empathetic analyst detecting student struggle. Output JSON only."
            });

            console.log(`🕵️ [TRACKER_DEBUG] LLM Raw Response:`, response.content);

            const content = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(content);
            
            console.log(`🕵️ [TRACKER_DEBUG] Parsed Result:`, result);

            return {
                topic: result.topic || 'General',
                isStruggling: result.isStruggling || false,
                reason: result.reason || ''
            };

        } catch (error) {
            console.error('❌ [TRACKER] Error analyzing message:', error);
            // Fail gracefully - assume no struggle
            return { isStruggling: false, topic: 'General', reason: 'Error' };
        }
    }
}

module.exports = TrackerService;
