/**
 * Chat API Routes
 * Handles chat functionality with real LLM integration
 * Replaces mock responses with actual AI-powered responses
 */

const express = require('express');
const router = express.Router();
const llmService = require('../services/llm');
const QdrantService = require('../services/qdrantService');

// Middleware to parse JSON bodies
router.use(express.json());

// Initialize Qdrant service for RAG
const qdrantService = new QdrantService();

/**
 * POST /api/chat
 * Send a message to the LLM with RAG (Retrieval-Augmented Generation)
 * Retrieves relevant document chunks based on student's question and selected unit
 */
router.post('/', async (req, res) => {
    try {
        const { message, conversationId, mode, unitName, courseId } = req.body;
        
        // Validate required fields
        if (!message || typeof message !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Message is required and must be a string'
            });
        }
        
        if (!unitName || typeof unitName !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Unit name is required for RAG functionality'
            });
        }
        
        console.log(`💬 Chat request received: "${message.substring(0, 50)}..."`);
        console.log(`🎯 Mode: ${mode || 'default'}`);
        console.log(`📚 Unit: ${unitName}`);
        console.log(`🏫 Course: ${courseId || 'default'}`);
        
        // Step 1: Initialize Qdrant service if needed
        if (!qdrantService.client) {
            console.log('🔧 Initializing Qdrant service for RAG...');
            await qdrantService.initialize();
        }
        
        // Step 2: Retrieve relevant document chunks using RAG
        console.log('🔍 Retrieving relevant document chunks...');
        const searchFilters = {
            courseId: courseId || 'default',
            lectureName: unitName
        };
        
        const relevantChunks = await qdrantService.searchDocuments(message, searchFilters, 5);
        console.log(`📄 Found ${relevantChunks.length} relevant chunks`);
        
        // Step 3: Build context window with retrieved chunks and citations
        let contextWindow = '';
        let citations = [];
        
        if (relevantChunks.length > 0) {
            contextWindow = 'Relevant course material:\n\n';
            
            relevantChunks.forEach((chunk, index) => {
                const citationId = index + 1;
                contextWindow += `[${citationId}] ${chunk.chunkText}\n\n`;
                
                citations.push({
                    id: citationId,
                    fileName: chunk.fileName,
                    lectureName: chunk.lectureName,
                    documentId: chunk.documentId,
                    chunkIndex: chunk.chunkIndex,
                    score: chunk.score
                });
            });
            
            contextWindow += 'Please use the above course material to answer the student\'s question. When referencing specific information, cite the source using [1], [2], etc.';
        } else {
            contextWindow = 'No specific course material found for this question. Please provide a general answer based on your knowledge of biology.';
            console.log('⚠️ No relevant chunks found, proceeding without RAG context');
        }
        
        // Step 4: Build enhanced system prompt with RAG context
        const baseSystemPrompt = llmService.getSystemPrompt();
        const modeSpecificPrompt = mode === 'protege' ? 
            '\n\nYou are in protégé mode. The student has demonstrated good understanding. Engage them as a study partner, ask follow-up questions, and explore topics together.' :
            '\n\nYou are in tutor mode. The student needs guidance. Provide clear explanations, examples, and step-by-step help.';
        
        const ragSystemPrompt = `${baseSystemPrompt}${modeSpecificPrompt}

IMPORTANT: Use the provided course material context to answer questions. Always cite your sources using [1], [2], etc. when referencing specific information from the course materials.

${contextWindow}`;
        
        // Step 5: Send enhanced prompt to LLM
        console.log('🤖 Sending enhanced prompt to LLM...');
        const response = await llmService.sendMessage(message, {
            temperature: mode === 'protege' ? 0.8 : 0.6,
            maxTokens: mode === 'protege' ? 600 : 400,
            systemPrompt: ragSystemPrompt
        });
        
        // Step 6: Format response with citations
        const chatResponse = {
            success: true,
            message: response.content,
            model: response.model,
            usage: response.usage,
            timestamp: new Date().toISOString(),
            mode: mode || 'default',
            unitName: unitName,
            citations: citations,
            ragEnabled: true,
            chunksRetrieved: relevantChunks.length
        };
        
        console.log(`✅ RAG response sent successfully with ${citations.length} citations`);
        
        res.json(chatResponse);
        
    } catch (error) {
        console.error('❌ Error in RAG chat endpoint:', error);
        
        // Provide user-friendly error messages
        let errorMessage = 'Sorry, I encountered an error processing your message.';
        let statusCode = 500;
        
        if (error.message.includes('OLLAMA_ENDPOINT')) {
            errorMessage = 'Ollama service is not available. Please check if Ollama is running.';
            statusCode = 503;
        } else if (error.message.includes('API key')) {
            errorMessage = 'Authentication error. Please check your API configuration.';
            statusCode = 401;
        } else if (error.message.includes('endpoint')) {
            errorMessage = 'Service endpoint is not reachable. Please check your configuration.';
            statusCode = 503;
        } else if (error.message.includes('Qdrant') || error.message.includes('vector')) {
            errorMessage = 'Document search service is temporarily unavailable. Please try again.';
            statusCode = 503;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/chat/status
 * Get the current status of the LLM service
 */
router.get('/status', async (req, res) => {
    try {
        const status = llmService.getStatus();
        
        res.json({
            success: true,
            data: status
        });
        
    } catch (error) {
        console.error('❌ Error getting chat status:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to get chat status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/chat/test
 * Test the LLM connection
 */
router.post('/test', async (req, res) => {
    try {
        console.log('🧪 Testing LLM connection...');
        
        const isConnected = await llmService.testConnection();
        
        if (isConnected) {
            res.json({
                success: true,
                message: 'LLM connection test successful',
                provider: llmService.getProviderName(),
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).json({
                success: false,
                message: 'LLM connection test failed',
                provider: llmService.getProviderName(),
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Error testing LLM connection:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to test LLM connection',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/chat/models
 * Get available models from the current provider
 */
router.get('/models', async (req, res) => {
    try {
        const models = await llmService.getAvailableModels();
        
        res.json({
            success: true,
            data: {
                models: models,
                provider: llmService.getProviderName(),
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error getting available models:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to get available models',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router; 