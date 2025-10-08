/**
 * Chat API Routes
 * Handles chat functionality with real LLM integration
 * Replaces mock responses with actual AI-powered responses
 */

const express = require('express');
const router = express.Router();
const LLMService = require('../services/llm');
const QdrantService = require('../services/qdrantService');
const prompts = require('../services/prompts');

// Initialize LLM service
let llmService;
(async () => {
    try {
        llmService = await LLMService.create();
        console.log('✅ LLM service initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize LLM service:', error);
    }
})();

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * POST /api/chat
 * Send a message to the LLM and get a response
 */
router.post('/', async (req, res) => {
    try {
        console.log('💬 [CHAT_API] New chat request received');
        console.log('💬 [CHAT_API] Message:', req.body.message?.substring(0, 50) + '...');
        console.log('💬 [CHAT_API] Has conversationContext:', !!req.body.conversationContext);
        
        // Check if LLM service is initialized
        if (!llmService) {
            return res.status(503).json({
                success: false,
                message: 'LLM service is not yet initialized. Please try again in a moment.'
            });
        }

        const { message, conversationId, mode, unitName, courseId, conversationContext } = req.body;
        
        
        // Validate required fields
        if (!message || typeof message !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Message is required and must be a string'
            });
        }
        
        console.log(`💬 Chat request received: "${message.substring(0, 50)}..."`);
        console.log(`🎯 Mode: ${mode || 'default'}`);

        // Require courseId and unitName per requirements
        if (!courseId || !unitName) {
            return res.status(400).json({
                success: false,
                message: 'courseId and unitName are required to start chat'
            });
        }

        // Initialize Qdrant and DB
        const qdrant = new QdrantService();
        await qdrant.initialize();

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Load course to get retrieval mode and published lectures
        const coursesCol = db.collection('courses');
        const course = await coursesCol.findOne({ courseId });
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        const isAdditive = !!course.isAdditiveRetrieval;

        // Build lectureNames filter using published units only, ordered by lectures array
        const publishedLectures = (course.lectures || []).filter(l => l.isPublished).map(l => l.name);
        if (!publishedLectures.includes(unitName)) {
            return res.status(400).json({ success: false, message: 'Selected unit is not published or does not exist' });
        }

        let lectureNames = [unitName];
        if (isAdditive) {
            const order = (course.lectures || []).filter(l => l.isPublished).map(l => l.name);
            const idx = order.indexOf(unitName);
            lectureNames = idx >= 0 ? order.slice(0, idx + 1) : [unitName];
        }

        // Debug logging to verify retrieval mode and scope
        console.log(`🔎 [CHAT_RAG] RetrievalMode=${isAdditive ? 'additive' : 'single'} | Course=${courseId} | Unit=${unitName} | LectureNames=${JSON.stringify(lectureNames)}`);

        // Retrieve top chunks from Qdrant
        const searchResults = await qdrant.searchDocuments(message, { courseId, lectureNames }, 12);

        // Log summary of results by lecture to validate scope
        try {
            const lecturesHit = Array.from(new Set((searchResults || []).map(r => r.lectureName)));
            console.log(`📚 [CHAT_RAG] Retrieved ${searchResults.length} chunks from lectures: ${lecturesHit.join(', ')}`);
            // Group by document to see which files contributed
            const byDoc = {};
            for (const r of (searchResults || [])) {
                const docId = r.documentId || 'unknown-doc';
                if (!byDoc[docId]) {
                    byDoc[docId] = {
                        fileName: r.fileName || 'unknown-filename',
                        lectures: new Set(),
                        count: 0,
                        maxScore: 0
                    };
                }
                byDoc[docId].count += 1;
                byDoc[docId].lectures.add(r.lectureName);
                if (typeof r.score === 'number' && r.score > byDoc[docId].maxScore) {
                    byDoc[docId].maxScore = r.score;
                }
            }
            const docKeys = Object.keys(byDoc);
            console.log(`📄 [CHAT_RAG] Documents contributing (${docKeys.length}):`);
            for (const k of docKeys) {
                const info = byDoc[k];
                const lecturesList = Array.from(info.lectures).join(', ');
                const scoreStr = info.maxScore ? info.maxScore.toFixed(3) : 'n/a';
                console.log(`   - ${info.fileName} (id=${k}) | lectures=[${lecturesList}] | chunks=${info.count} | maxScore=${scoreStr}`);
            }
        } catch (_) {}

        // Build concise context window with citations
        const citations = searchResults.map(r => ({
            lectureName: r.lectureName,
            fileName: r.fileName,
            score: r.score
        }));
        const contextText = searchResults
            .map(r => `From ${r.lectureName} (${r.fileName}):\n${r.chunkText}`)
            .join('\n\n---\n\n');
        
        // Build the message to send to LLM
        let messageToSend = `Use only the provided course context to answer. Cite which unit a fact came from.
\n\nCourse context:\n${contextText}\n\nStudent question: ${message}`;

        // If we have conversation context (continuing a chat), use structured conversation approach
        if (conversationContext && conversationContext.conversationMessages) {
            console.log('🔄 [CHAT_CONTINUE] Using structured conversation context');
            
            // Build the conversation history as a single message
            let conversationHistory = '';
            conversationContext.conversationMessages.forEach(msg => {
                const speaker = msg.role === 'user' ? 'Student' : 'BiocBot';
                conversationHistory += `${speaker}: ${msg.content}\n\n`;
            });
            
            // Add the student's new message
            conversationHistory += `Student: ${message}`;
            
            // Create the full message with conversation context
            messageToSend = `Use only the provided course context to answer. Cite which unit a fact came from.

Course context:
${contextText}

Previous conversation:
${conversationHistory}`;
        }

        // For now, we'll use single message approach
        // In the future, we can implement conversation persistence
        let response = await llmService.sendMessage(
            messageToSend,
            {
            // Adjust response based on student mode
            temperature: mode === 'protege' ? 0.5 : 0.5,
            maxTokens: mode === 'protege' ? 1000 : 1000,
            systemPrompt: llmService.getSystemPrompt() + 
                (mode === 'protege' ? 
                    '\n\nYou are in protégé mode. The student has demonstrated good understanding. Engage them as a study partner, ask follow-up questions, and explore topics together.' :
                    '\n\nYou are in tutor mode. The student needs guidance. Provide clear explanations, examples, and step-by-step help.'
                )
        });
        
        let fullContent = response && response.content ? response.content : '';

        // Detect truncation and auto-continue up to N times
        function extractFinishReason(resp) {
            try {
                return (resp && (resp.finishReason || resp.finish_reason || (resp.usage && resp.usage.finish_reason) || resp.stopReason || resp.stop_reason)) || '';
            } catch (e) { return ''; }
        }
        function isLikelyTruncated(resp, content) {
            const fr = (extractFinishReason(resp) + '').toLowerCase();
            if (fr.includes('length') || fr.includes('token')) return true;
            if (!content) return false;
            const tail = content.slice(-60);
            const endsClean = /[\.\!\?]\s*$/.test(tail);
            return !endsClean && content.length > 300;
        }
        
        const MAX_CONTINUATIONS = 2;
        let cont = 0;
        while (cont < MAX_CONTINUATIONS && isLikelyTruncated(response, fullContent)) {
            cont += 1;
            console.log(`⏩ [CHAT_CONTINUE] Requesting continuation ${cont}; current length=${fullContent.length}`);
            const tailSnippet = fullContent.slice(-200);
            const contPrompt = `Continue the previous answer. Do not repeat earlier content. Pick up seamlessly from here: "${tailSnippet}"`;
            const contResp = await llmService.sendMessage(contPrompt, {
                temperature: mode === 'protege' ? 0.8 : 0.6,
                maxTokens: mode === 'protege' ? 800 : 800,
                systemPrompt: llmService.getSystemPrompt() + 
                    (mode === 'protege' ? 
                        '\n\nYou are in protégé mode. The student has demonstrated good understanding. Continue the explanation succinctly.' :
                        '\n\nYou are in tutor mode. Continue the explanation clearly and step-by-step.'
                    )
            });
            const chunk = contResp && contResp.content ? contResp.content : '';
            console.log(`📎 [CHAT_CONTINUE] Received chunk ${cont} length=${chunk.length}`);
            if (chunk) {
                fullContent += (fullContent.endsWith('\n') ? '' : '\n') + chunk;
            }
            response = contResp;
        }
        
        // Format response for frontend
        const chatResponse = {
            success: true,
            message: fullContent,
            model: response.model,
            usage: response.usage,
            timestamp: new Date().toISOString(),
            mode: mode || 'default',
            citations,
            retrieval: {
                mode: isAdditive ? 'additive' : 'single',
                lectureNames
            }
        };
        
        console.log(`✅ Chat response sent successfully`);
        
        res.json(chatResponse);
        
    } catch (error) {
        console.error('❌ Error in chat endpoint:', error);
        
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
        const llmService = req.app.locals.llm;
        
        if (!llmService) {
            return res.status(503).json({
                success: false,
                message: 'LLM service is not initialized'
            });
        }
        
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
        
        const llmService = req.app.locals.llm;
        
        if (!llmService) {
            return res.status(503).json({
                success: false,
                message: 'LLM service is not initialized'
            });
        }
        
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
        const llmService = req.app.locals.llm;
        
        if (!llmService) {
            return res.status(503).json({
                success: false,
                message: 'LLM service is not initialized'
            });
        }
        
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

/**
 * POST /api/chat/save
 * Save a chat session to the database for instructor access
 */
router.post('/save', async (req, res) => {
    try {
        const { 
            sessionId, 
            courseId, 
            studentId, 
            studentName, 
            unitName, 
            title, 
            messageCount, 
            duration, 
            savedAt, 
            chatData 
        } = req.body;
        
        // Validate required fields
        if (!sessionId || !courseId || !studentId || !studentName) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: sessionId, courseId, studentId, studentName'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Save chat session to database
        const chatSessionsCollection = db.collection('chat_sessions');
        
        const sessionData = {
            sessionId,
            courseId,
            studentId,
            studentName,
            unitName: unitName || 'Unknown Unit',
            title: title || `Chat Session ${new Date().toLocaleDateString()}`,
            messageCount: messageCount || 0,
            duration: duration || 'Unknown',
            savedAt: savedAt || new Date().toISOString(),
            chatData: chatData || {},
            isDeleted: false, // Soft deletion flag
            createdAt: new Date()
        };
        
        // Insert or update the session
        await chatSessionsCollection.replaceOne(
            { sessionId: sessionId },
            sessionData,
            { upsert: true }
        );
        
        console.log(`Chat session saved: ${sessionId} for student ${studentName} in course ${courseId}`);
        
        res.json({
            success: true,
            message: 'Chat session saved successfully',
            data: {
                sessionId: sessionId,
                courseId: courseId,
                studentId: studentId
            }
        });
        
    } catch (error) {
        console.error('Error saving chat session:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while saving chat session'
        });
    }
});

module.exports = router; 