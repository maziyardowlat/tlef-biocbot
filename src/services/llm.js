/**
 * LLM Service
 * Integrates with UBC GenAI Toolkit for chat functionality
 * Supports multiple providers: Ollama, OpenAI, UBC LLM Sandbox
 */

const { LLMModule } = require('ubc-genai-toolkit-llm');
const config = require('./config');

class LLMService {
    constructor() {
        // Don't initialize immediately - wait for first use
        this.llm = null;
        this.isInitialized = false;
        this.llmConfig = null;
        this.initializationPromise = null;
        
        console.log(`🔧 LLM service created (lazy initialization enabled)`);
    }
    
    /**
     * Initialize the LLM service on first use
     * @returns {Promise<void>}
     */
    async initialize() {
        // If already initialized, return immediately
        if (this.isInitialized) {
            return;
        }
        
        // If initialization is in progress, wait for it
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        
        // Start initialization
        this.initializationPromise = this._performInitialization();
        
        try {
            await this.initializationPromise;
        } finally {
            this.initializationPromise = null;
        }
    }
    
    /**
     * Perform the actual LLM initialization
     * @returns {Promise<void>}
     */
    async _performInitialization() {
        try {
            // Get configuration for current environment
            this.llmConfig = config.getLLMConfig();
            
            console.log(`🚀 Initializing LLM service with provider: ${this.llmConfig.provider}`);
            
            // Initialize UBC GenAI Toolkit with the configured provider
            this.llm = new LLMModule(this.llmConfig);
            this.isInitialized = true;
            
            console.log(`✅ LLM service initialized successfully`);
            
        } catch (error) {
            console.error('❌ Failed to initialize LLM service:', error.message);
            this.isInitialized = false;
            this.llm = null;
            throw error;
        }
    }
    
    /**
     * Send a single message to the LLM
     * @param {string} message - The message to send
     * @param {Object} options - Additional options for the LLM
     * @returns {Promise<Object>} LLM response
     */
    async sendMessage(message, options = {}) {
        try {
            // Initialize LLM service on first use
            if (!this.isInitialized) {
                console.log(`🔄 Initializing LLM service for first use...`);
                await this.initialize();
            }
            
            console.log(`📤 Sending message to LLM: "${message.substring(0, 50)}..."`);
            
            // Set default options for BiocBot context
            const defaultOptions = {
                systemPrompt: this.getSystemPrompt(),
                temperature: 0.1,
                num_ctx: 32768,
                ...options
            };
            console.log('🔍 [LLM_OPTIONS] Default options:', defaultOptions);
            
            const response = await this.llm.sendMessage(message, defaultOptions);
            
            console.log(`✅ LLM response received (${response.content.length} characters)`);
            return response;
            
        } catch (error) {
            console.error('❌ Error sending message to LLM:', error.message);
            throw error;
        }
    }
    
    /**
     * Create a conversation for multi-turn chat
     * @returns {Object} Conversation object
     */
    async createConversation() {
        try {
            // Initialize LLM service on first use
            if (!this.isInitialized) {
                console.log(`🔄 Initializing LLM service for first use...`);
                await this.initialize();
            }
            
            const conversation = this.llm.createConversation();
            
            // Set initial system prompt for BiocBot
            conversation.addMessage('system', this.getSystemPrompt());
            
            console.log('💬 Conversation created successfully');
            return conversation;
            
        } catch (error) {
            console.error('❌ Error creating conversation:', error.message);
            throw error;
        }
    }
    
    /**
     * Send a message in conversation context
     * @param {Object} conversation - The conversation object
     * @param {string} message - The user message
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} LLM response
     */
    async sendConversationMessage(conversation, message, options = {}) {
        try {
            // Initialize LLM service on first use
            if (!this.isInitialized) {
                console.log(`🔄 Initializing LLM service for first use...`);
                await this.initialize();
            }
            
            // Add user message to conversation
            conversation.addMessage('user', message);
            
            // Set default options for BiocBot
            const defaultOptions = {
                temperature: 0.1,
                num_ctx: 32768,
                ...options
            };
            
            // Send message and get response
            const response = await conversation.send(defaultOptions);
            
            console.log(`💬 Conversation response received (${response.content.length} characters)`);
            return response;
            
        } catch (error) {
            console.error('❌ Error in conversation:', error.message);
            throw error;
        }
    }
    
    /**
     * Get available models from the current provider
     * @returns {Promise<Array>} List of available models
     */
    async getAvailableModels() {
        try {
            // Initialize LLM service on first use
            if (!this.isInitialized) {
                console.log(`🔄 Initializing LLM service for first use...`);
                await this.initialize();
            }
            
            const models = await this.llm.getAvailableModels();
            console.log(`📋 Available models: ${models.length} found`);
            return models;
        } catch (error) {
            console.error('❌ Error getting available models:', error.message);
            throw error;
        }
    }
    
    /**
     * Get the current provider name
     * @returns {string} Provider name
     */
    getProviderName() {
        if (!this.isInitialized) {
            return 'Not initialized';
        }
        return this.llm.getProviderName();
    }
    
    /**
     * Get system prompt for BiocBot
     * @returns {string} System prompt
     */
    getSystemPrompt() {
        return `You are BiocBot, an AI-powered study assistant for biology courses at UBC. 

Your role is to help students understand course material by:
- Providing clear, accurate explanations of biological concepts
- Citing specific course materials when possible
- Adapting your teaching style based on the student's level
- Encouraging critical thinking and deeper understanding
- Being helpful while maintaining academic integrity

Current course: BIOC 202 (Cellular Processes and Reactions)

Guidelines:
- Keep responses focused and relevant to the course material
- Use clear, accessible language appropriate for university students
- If you're unsure about something, acknowledge the limitation
- Encourage students to verify important information with their course materials
- Be supportive and encouraging of student learning

Remember: You're here to help students learn, not to replace their course materials or instructors.`;
    }
    
    /**
     * Test the LLM connection
     * @returns {Promise<boolean>} True if connection is working
     */
    async testConnection() {
        try {
            console.log('🔍 Testing LLM connection...');
            
            const response = await this.sendMessage('Hello, this is a connection test.');
            
            if (response && response.content) {
                console.log('✅ LLM connection test successful');
                return true;
            } else {
                console.log('❌ LLM connection test failed - no response content');
                return false;
            }
            
        } catch (error) {
            console.error('❌ LLM connection test failed:', error.message);
            return false;
        }
    }
    
    /**
     * Check if the LLM service is ready to use
     * @returns {boolean} True if service is initialized and ready
     */
    isReady() {
        return this.isInitialized && !!this.llm;
    }
    
    /**
     * Get service status information
     * @returns {Object} Service status
     */
    getStatus() {
        return {
            provider: this.getProviderName(),
            isConnected: this.isInitialized && !!this.llm,
            isInitialized: this.isInitialized,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Generate assessment questions based on course material content
     * @param {string} questionType - Type of question to generate ('true-false', 'multiple-choice', 'short-answer')
     * @param {string} courseMaterialContent - The course material text content
     * @param {string} unitName - Name of the unit (e.g., 'Unit 1')
     * @returns {Promise<Object>} Generated question content
     */
    async generateAssessmentQuestion(questionType, courseMaterialContent, unitName) {
        try {
            // Initialize LLM service on first use
            if (!this.isInitialized) {
                console.log(`🔄 Initializing LLM service for question generation...`);
                await this.initialize();
            }
            
            console.log(`🤖 Generating ${questionType} question for ${unitName}...`);
            
            // Create specific prompt based on question type
            const prompt = this.createQuestionGenerationPrompt(questionType, courseMaterialContent, unitName);
            
            // Set specific options for question generation
            // Use higher temperature (0.7) for more creative question generation
            const generationOptions = {
                temperature: 0.7,
                num_ctx: 32768,
                // responseFormat: "json", 
                systemPrompt: this.getQuestionGenerationSystemPrompt()
            };
            
            console.log('🤖 [LLM_REQUEST] Sending prompt to LLM:', prompt);
            
            const response = await this.llm.sendMessage(prompt, generationOptions);
            console.log('🤖 [LLM_RESPONSE] Raw response from LLM:', response);
            
            if (!response || !response.content) {
                throw new Error('No response content received from LLM');
            }
            
            console.log('🤖 [LLM_CONTENT] Response content:', response.content);
            
            // Parse the response to extract question components
            const parsedQuestion = this.parseGeneratedQuestion(response.content, questionType);
            console.log('🤖 [LLM_PARSED] Parsed question:', parsedQuestion);
            
            console.log(`✅ Question generated successfully for ${unitName}`);
            return parsedQuestion;
            
        } catch (error) {
            console.error('❌ Error generating assessment question:', error.message);
            throw error;
        }
    }
    
    /**
     * Create a specific prompt for question generation based on type
     * @param {string} questionType - Type of question to generate
     * @param {string} courseMaterialContent - Course material content
     * @param {string} unitName - Unit name
     * @returns {string} Formatted prompt for the LLM
     */
    createQuestionGenerationPrompt(questionType, courseMaterialContent, unitName) {
        const basePrompt = `Based on the following course material and learning objectives from ${unitName}, generate a high-quality ${questionType} question that will help gauge a student's understanding of the key concepts.

Course Material Content:
${courseMaterialContent}

Please generate a question that:
- Tests understanding of the main concepts from the material
- Aligns with the provided learning objectives (if any)
- Is appropriate for university-level students
- Has clear, unambiguous wording
- Includes the correct answer and explanation
- Focuses on testing conceptual understanding rather than just recall

Question Type: ${questionType}`;
        
        switch (questionType) {
            case 'true-false':
                return `${basePrompt}

Format your response exactly as follows:
QUESTION: [Your true/false question here]
ANSWER: [true or false]
EXPLANATION: [Brief explanation of why this answer is correct]`;
                
            case 'multiple-choice':
                return `${basePrompt}

You MUST format your response EXACTLY as follows:
QUESTION: [Your multiple choice question here]
OPTIONS:
A: [The correct answer option]
B: [A plausible but incorrect option]
C: [Another plausible but incorrect option]
D: [Another plausible but incorrect option]
ANSWER: A
EXPLANATION: [Brief explanation of why the chosen option is correct]

IMPORTANT RULES:
1. Generate 4 distinct, plausible options
2. Place the correct answer randomly among A/B/C/D (don't always use A)
3. Make incorrect options plausible but clearly wrong
4. All options should be similar in length and style
5. Avoid obvious wrong answers or joke options
6. Update the ANSWER field to match whichever option (A/B/C/D) contains the correct answer`;
                
            case 'short-answer':
                return `${basePrompt}

You MUST format your response EXACTLY as follows, including ALL three sections:
QUESTION: [Your short answer question here]
EXPECTED_ANSWER: [Detailed key points or model answer that would constitute a complete response]
EXPLANATION: [Brief explanation of the key concepts being tested and how to evaluate responses]

Remember: The EXPECTED_ANSWER section is required and should provide clear guidance on what constitutes a complete answer.`;
                
            default:
                return basePrompt;
        }
    }
    
    /**
     * Get system prompt specifically for question generation
     * @returns {string} System prompt for question generation
     */
    getQuestionGenerationSystemPrompt() {
        return `You are an expert educational content creator specializing in creating assessment questions for university-level biology courses.

Your task is to generate high-quality questions that:
- Accurately reflect the course material content provided
- Test students' understanding of key concepts
- Are clear, unambiguous, and well-structured
- Include appropriate difficulty for university students
- STRICTLY follow the exact format specified in the user prompt

CRITICAL FORMAT REQUIREMENTS:
1. Your response MUST start with "QUESTION:" followed by the question text
2. For short-answer questions:
   - MUST include "EXPECTED_ANSWER:" with detailed key points
   - MUST include "EXPLANATION:" with evaluation criteria
3. For multiple-choice questions:
   - MUST include all four options (A, B, C, D)
   - MUST specify correct answer
4. For true-false questions:
   - MUST explicitly state "true" or "false"
   - MUST include explanation

Guidelines:
- Base questions ONLY on the provided course material
- Ensure questions are relevant and specific to the content
- Make questions challenging but fair
- Provide clear, concise explanations
- Use academic language appropriate for university students
- NEVER skip any required sections of the response format

Remember: Formatting is critical. Always include ALL required sections exactly as specified in the user prompt.`;
    }
    
    /**
     * Parse the LLM response to extract question components
     * @param {string} responseContent - Raw response from LLM
     * @param {string} questionType - Type of question
     * @returns {Object} Parsed question object
     */
    parseGeneratedQuestion(responseContent, questionType) {
        try {
            console.log('🔍 [PARSE] Starting to parse response content:', responseContent);
            
            // Split content into lines and clean them
            const lines = responseContent.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            console.log('🔍 [PARSE] Split lines:', lines);
            
            const parsed = {};
            
            // First pass: Extract sections with their full content
            let currentSection = null;
            let currentContent = [];
            
            lines.forEach(line => {
                // Check if this is a section header
                if (line.includes(':') && line.split(':')[0].toUpperCase() === line.split(':')[0]) {
                    // If we were building a previous section, save it
                    if (currentSection && currentContent.length > 0) {
                        parsed[currentSection] = currentContent.join('\n').trim();
                        currentContent = [];
                    }
                    currentSection = line.split(':')[0].trim();
                    const value = line.substring(line.indexOf(':') + 1).trim();
                    if (value) currentContent.push(value);
                } else if (currentSection) {
                    currentContent.push(line);
                }
            });
            
            // Save the last section if any
            if (currentSection && currentContent.length > 0) {
                parsed[currentSection] = currentContent.join('\n').trim();
            }
            
            console.log('🔍 [PARSE] Initial parsing result:', parsed);
            
            // Extract question text
            if (parsed.QUESTION) {
                parsed.question = parsed.QUESTION;
            }
            
            // Extract answer based on question type
            if (questionType === 'true-false') {
                if (parsed.ANSWER) {
                    parsed.answer = parsed.ANSWER.toLowerCase() === 'true' ? 'true' : 'false';
                }
                if (parsed.EXPLANATION) {
                    parsed.explanation = parsed.EXPLANATION;
                }
            } else if (questionType === 'multiple-choice') {
                if (parsed.ANSWER) {
                    parsed.answer = parsed.ANSWER.toUpperCase();
                }
                // For multiple choice, we need to extract the options carefully
                const options = {};
                let inOptionsSection = false;
                let currentOption = null;
                
                console.log('🔍 [PARSE_MCQ] Processing lines for options');
                
                lines.forEach(line => {
                    // Check if we're entering the options section
                    if (line.trim() === 'OPTIONS:') {
                        inOptionsSection = true;
                        return;
                    }
                    
                    // If we're in the options section, look for options
                    if (inOptionsSection) {
                        // Check if this is an option line (A:, B:, etc.)
                        if (line.match(/^[A-D]:/)) {
                            currentOption = line[0]; // Get the option letter
                            const optionText = line.substring(2).trim(); // Get text after the colon
                            options[currentOption] = optionText;
                            console.log(`🔍 [PARSE_MCQ] Found option ${currentOption}:`, optionText);
                        } else if (line.startsWith('ANSWER:') || line.startsWith('EXPLANATION:')) {
                            // We've reached the end of the options section
                            inOptionsSection = false;
                        } else if (currentOption && line.trim()) {
                            // This is a continuation of the previous option
                            options[currentOption] += ' ' + line.trim();
                            console.log(`🔍 [PARSE_MCQ] Extended option ${currentOption}:`, options[currentOption]);
                        }
                    }
                });
                
                // Verify we have all options
                const hasAllOptions = ['A', 'B', 'C', 'D'].every(opt => options[opt]);
                if (!hasAllOptions) {
                    console.warn('⚠️ [PARSE_MCQ] Missing some options:', options);
                } else {
                    console.log('✅ [PARSE_MCQ] Successfully parsed all options:', options);
                }
                
                parsed.options = options;
                
                if (parsed.EXPLANATION) {
                    parsed.explanation = parsed.EXPLANATION;
                }
            } else if (questionType === 'short-answer') {
                // For short answer, we want both the expected answer and explanation
                if (parsed.EXPECTED_ANSWER) {
                    parsed.answer = parsed.EXPECTED_ANSWER;
                    // Also store it in expectedAnswer to ensure it's included
                    parsed.expectedAnswer = parsed.EXPECTED_ANSWER;
                }
                if (parsed.EXPLANATION) {
                    parsed.explanation = parsed.EXPLANATION;
                }
                
                // Log the parsed content for debugging
                console.log('🔍 [LLM_PARSE] Short answer content:', {
                    rawExpectedAnswer: parsed.EXPECTED_ANSWER,
                    parsedAnswer: parsed.answer,
                    parsedExpectedAnswer: parsed.expectedAnswer,
                    explanation: parsed.explanation
                });
            }
            
            return parsed;
            
        } catch (error) {
            console.error('Error parsing generated question:', error);
            // Return a fallback structure
            return {
                question: 'Error parsing generated question. Please try again.',
                answer: questionType === 'true-false' ? 'true' : questionType === 'multiple-choice' ? 'A' : 'Please review the generated content.',
                options: questionType === 'multiple-choice' ? { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' } : {},
                explanation: 'Question generation completed but parsing failed. Please review and edit the content.'
            };
        }
    }
}

module.exports = new LLMService(); 