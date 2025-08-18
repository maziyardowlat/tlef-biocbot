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
                temperature: 0.7,
                maxTokens: 500,
                ...options
            };
            
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
                temperature: 0.7,
                maxTokens: 500,
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
}

module.exports = new LLMService(); 