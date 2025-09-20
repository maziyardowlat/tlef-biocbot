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
    const requestId = Math.random().toString(36).substring(7);
    const startTime = Date.now();
    
    try {
        console.log(`=== CHAT REQUEST START [${requestId}] ===`);
        console.log(`[${requestId}] Request body:`, JSON.stringify(req.body, null, 2));
        console.log(`[${requestId}] Environment variables check:`, {
            NODE_ENV: process.env.NODE_ENV,
            LLM_PROVIDER: process.env.LLM_PROVIDER,
            OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT,
            OLLAMA_MODEL: process.env.OLLAMA_MODEL,
            QDRANT_URL: process.env.QDRANT_URL,
            LLM_EMBEDDING_MODEL: process.env.LLM_EMBEDDING_MODEL
        });
        
        const { message, conversationId, mode, unitName, courseId } = req.body;
        
        // Validate required fields
        if (!message || typeof message !== 'string') {
            console.log(`[${requestId}] ❌ Validation failed: Message is required and must be a string`);
            return res.status(400).json({
                success: false,
                message: 'Message is required and must be a string',
                requestId: requestId
            });
        }
        
        if (!unitName || typeof unitName !== 'string') {
            console.log(`[${requestId}] ❌ Validation failed: Unit name is required for RAG functionality`);
            return res.status(400).json({
                success: false,
                message: 'Unit name is required for RAG functionality',
                requestId: requestId
            });
        }
        
        console.log(`[${requestId}] 💬 Chat request received: "${message.substring(0, 50)}..."`);
        console.log(`[${requestId}] 🎯 Mode: ${mode || 'default'}`);
        console.log(`[${requestId}] 📚 Unit: ${unitName}`);
        console.log(`[${requestId}] 🏫 Course: ${courseId || 'default'}`);
        
        // Step 1: Initialize Qdrant service if needed (optional for basic chat)
        let qdrantAvailable = false;
        if (!qdrantService.client) {
            console.log('🔧 Initializing Qdrant service for RAG...');
            try {
                await qdrantService.initialize();
                console.log('✅ Qdrant service initialized successfully');
                qdrantAvailable = true;
            } catch (qdrantError) {
                console.error('❌ Failed to initialize Qdrant service:', qdrantError);
                console.log('⚠️ Continuing without RAG functionality');
                qdrantAvailable = false;
            }
        } else {
            qdrantAvailable = true;
        }
        
        // Step 2: Retrieve relevant document chunks using RAG (if available)
        let relevantChunks = [];
        if (qdrantAvailable) {
            console.log('🔍 Retrieving relevant document chunks...');
            const searchFilters = {
                courseId: courseId || 'default',
                lectureName: unitName
            };
            
            console.log('Search filters:', searchFilters);
            
            try {
                relevantChunks = await qdrantService.searchDocuments(message, searchFilters, 5);
                console.log(`📄 Found ${relevantChunks.length} relevant chunks`);
            } catch (searchError) {
                console.error('❌ Error during document search:', searchError);
                // Continue without RAG context if search fails
                console.log('⚠️ Continuing without RAG context due to search error');
                relevantChunks = [];
            }
        } else {
            console.log('⚠️ Qdrant not available, skipping RAG search');
        }
        
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
        } else if (qdrantAvailable) {
            contextWindow = 'No specific course material found for this question. Please provide a general answer based on your knowledge of biology.';
            console.log('⚠️ No relevant chunks found, proceeding without RAG context');
        } else {
            contextWindow = 'Course material search is currently unavailable. Please provide a general answer based on your knowledge of biology.';
            console.log('⚠️ RAG not available, using general knowledge mode');
        }
        
        // Step 4: Build enhanced system prompt with RAG context
        const baseSystemPrompt = llmService.getSystemPrompt();
        const modeSpecificPrompt = mode === 'protege' ? 
            '\n\nYou are in protégé mode. The student has demonstrated good understanding. Engage them as a study partner, ask follow-up questions, and explore topics together.' :
            '\n\nYou are in tutor mode. The student needs guidance. Provide clear explanations, examples, and step-by-step help.';
        
        const ragSystemPrompt = `${baseSystemPrompt}${modeSpecificPrompt}

IMPORTANT: Use the provided course material context to answer questions. Always cite your sources using [1], [2], etc. when referencing specific information from the course materials.

${contextWindow}`;
        
        // Step 5: Send enhanced prompt to LLM with timeout
        console.log(`[${requestId}] 🤖 Sending enhanced prompt to LLM...`);
        console.log(`[${requestId}] LLM service status:`, llmService.getStatus());
        
        let response;
        try {
            // Add timeout wrapper for LLM call
            const llmPromise = llmService.sendMessage(message, {
                temperature: mode === 'protege' ? 0.8 : 0.6,
                maxTokens: mode === 'protege' ? 600 : 400,
                systemPrompt: ragSystemPrompt
            });
            
            // Set timeout of 30 seconds for LLM response
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('LLM request timeout after 30 seconds')), 30000);
            });
            
            response = await Promise.race([llmPromise, timeoutPromise]);
            console.log(`[${requestId}] ✅ LLM response received successfully`);
        } catch (llmError) {
            console.error(`[${requestId}] ❌ Error calling LLM service:`, llmError);
            console.error(`[${requestId}] LLM error details:`, {
                message: llmError.message,
                stack: llmError.stack,
                name: llmError.name,
                code: llmError.code
            });
            
            // Provide more specific error messages
            if (llmError.message.includes('timeout')) {
                throw new Error('LLM request timed out. Please try again with a shorter message.');
            } else if (llmError.message.includes('ECONNREFUSED')) {
                throw new Error('Cannot connect to LLM service. Please check if Ollama is running.');
            } else if (llmError.message.includes('ENOTFOUND')) {
                throw new Error('LLM service endpoint not found. Please check your configuration.');
            } else {
                throw new Error(`LLM service error: ${llmError.message}`);
            }
        }
        
        // Step 6: Format response with citations
        const processingTime = Date.now() - startTime;
        const chatResponse = {
            success: true,
            message: response.content,
            model: response.model,
            usage: response.usage,
            timestamp: new Date().toISOString(),
            mode: mode || 'default',
            unitName: unitName,
            citations: citations,
            ragEnabled: qdrantAvailable,
            chunksRetrieved: relevantChunks.length,
            processingTime: processingTime,
            requestId: requestId,
            services: {
                qdrant: qdrantAvailable ? 'available' : 'unavailable',
                llm: 'available'
            }
        };
        
        console.log(`[${requestId}] ✅ RAG response sent successfully with ${citations.length} citations (${processingTime}ms)`);
        
        res.json(chatResponse);
        
    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`[${requestId}] ❌ Error in RAG chat endpoint:`, error);
        console.error(`[${requestId}] Error details:`, {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
            processingTime: processingTime
        });
        
        // Provide user-friendly error messages
        let errorMessage = 'Sorry, I encountered an error processing your message.';
        let statusCode = 500;
        
        if (error.message.includes('timeout')) {
            errorMessage = 'Request timed out. Please try again with a shorter message.';
            statusCode = 408;
        } else if (error.message.includes('ECONNREFUSED')) {
            errorMessage = 'Cannot connect to required services. Please try again later.';
            statusCode = 503;
        } else if (error.message.includes('ENOTFOUND')) {
            errorMessage = 'Service endpoint not found. Please check your configuration.';
            statusCode = 503;
        } else if (error.message.includes('OLLAMA_ENDPOINT')) {
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
            requestId: requestId,
            processingTime: processingTime,
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