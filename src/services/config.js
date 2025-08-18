/**
 * Configuration Service
 * Reads environment variables and provides configuration for different services
 * Uses single .env file approach for simplicity
 */

class ConfigService {
    constructor() {
        // Validate configuration on startup
        this.validateConfig();
    }
    
    /**
     * Get LLM configuration based on environment variables
     * @returns {Object} LLM configuration object
     */
    getLLMConfig() {
        const provider = process.env.LLM_PROVIDER;
        
        switch (provider) {
            case 'ollama':
                return {
                    provider: 'ollama',
                    endpoint: process.env.OLLAMA_ENDPOINT,
                    defaultModel: process.env.OLLAMA_MODEL
                };
                
            case 'openai':
                return {
                    provider: 'openai',
                    apiKey: process.env.OPENAI_API_KEY,
                    defaultModel: process.env.OPENAI_MODEL
                };
                
            case 'ubc-llm-sandbox':
                return {
                    provider: 'ubc-llm-sandbox',
                    apiKey: process.env.UBC_API_KEY,
                    endpoint: process.env.UBC_ENDPOINT,
                    defaultModel: process.env.UBC_MODEL
                };
                
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`);
        }
    }
    
    /**
     * Get server configuration
     * @returns {Object} Server configuration object
     */
    getServerConfig() {
        return {
            port: process.env.TLEF_BIOCBOT_PORT || 8080,
            nodeEnv: process.env.NODE_ENV || 'development'
        };
    }
    
    /**
     * Get database configuration
     * @returns {Object} Database configuration object
     */
    getDatabaseConfig() {
        return {
            mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/biocbot'
        };
    }
    
    /**
     * Get vector database configuration
     * @returns {Object} Vector database configuration object
     */
    getVectorDBConfig() {
        return {
            host: process.env.QDRANT_HOST || 'localhost',
            port: parseInt(process.env.QDRANT_PORT) || 6333
        };
    }
    
    /**
     * Validate that required configuration is present
     * Throws error if configuration is invalid
     */
    validateConfig() {
        const llmConfig = this.getLLMConfig();
        
        // Validate provider-specific requirements
        if (llmConfig.provider === 'ollama') {
            if (!process.env.OLLAMA_ENDPOINT) {
                throw new Error('OLLAMA_ENDPOINT is required for Ollama provider');
            }
            if (!process.env.OLLAMA_MODEL) {
                throw new Error('OLLAMA_MODEL is required for Ollama provider');
            }
        } else if (llmConfig.provider === 'openai') {
            if (!process.env.OPENAI_API_KEY) {
                throw new Error('OPENAI_API_KEY is required for OpenAI provider');
            }
            if (!process.env.OPENAI_MODEL) {
                throw new Error('OPENAI_MODEL is required for OpenAI provider');
            }
        } else if (llmConfig.provider === 'ubc-llm-sandbox') {
            if (!process.env.UBC_API_KEY) {
                throw new Error('UBC_API_KEY is required for UBC LLM Sandbox provider');
            }
            if (!process.env.UBC_ENDPOINT) {
                throw new Error('UBC_ENDPOINT is required for UBC LLM Sandbox provider');
            }
            if (!process.env.UBC_MODEL) {
                throw new Error('UBC_MODEL is required for UBC LLM Sandbox provider');
            }
        }
        
        console.log(`✅ Configuration validated successfully`);
        console.log(`🤖 LLM Provider: ${llmConfig.provider}`);
        console.log(`🔑 Model: ${llmConfig.defaultModel}`);
    }
    
    /**
     * Get current environment name
     * @returns {string} Environment name
     */
    getEnvironment() {
        return process.env.NODE_ENV || 'development';
    }
    
    /**
     * Check if running in development mode
     * @returns {boolean} True if development mode
     */
    isDevelopment() {
        return this.getEnvironment() === 'development';
    }
    
    /**
     * Check if running in production mode
     * @returns {boolean} True if production mode
     */
    isProduction() {
        return this.getEnvironment() === 'production';
    }
}

module.exports = new ConfigService(); 