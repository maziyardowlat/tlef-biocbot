#!/usr/bin/env node

/**
 * Production Chat Test Script
 * Tests the chat endpoint directly to identify the 500 error
 */

require('dotenv').config();

console.log('🧪 Testing Production Chat Endpoint');
console.log('==================================\n');

// Test configuration loading
console.log('📋 Testing Configuration Loading:');
console.log('---------------------------------');

try {
    const config = require('./src/services/config');
    
    console.log('✅ Config service loaded successfully');
    
    // Test LLM config
    try {
        const llmConfig = config.getLLMConfig();
        console.log('✅ LLM config loaded:', {
            provider: llmConfig.provider,
            endpoint: llmConfig.endpoint ? 'SET' : 'NOT SET',
            model: llmConfig.defaultModel
        });
    } catch (error) {
        console.log('❌ LLM config failed:', error.message);
    }
    
    // Test Vector DB config
    try {
        const vectorConfig = config.getVectorDBConfig();
        console.log('✅ Vector DB config loaded:', vectorConfig);
    } catch (error) {
        console.log('❌ Vector DB config failed:', error.message);
    }
    
    // Test Database config
    try {
        const dbConfig = config.getDatabaseConfig();
        console.log('✅ Database config loaded:', {
            mongoUri: dbConfig.mongoUri ? 'SET' : 'NOT SET'
        });
    } catch (error) {
        console.log('❌ Database config failed:', error.message);
    }
    
} catch (error) {
    console.log('❌ Config service failed to load:', error.message);
}

console.log('\n🔧 Testing Service Initialization:');
console.log('----------------------------------');

// Test LLM service
async function testLLMService() {
    try {
        const llmService = require('./src/services/llm');
        console.log('✅ LLM service loaded');
        
        const status = llmService.getStatus();
        console.log('LLM status:', status);
        
        // Test connection
        const isConnected = await llmService.testConnection();
        console.log('LLM connection test:', isConnected ? '✅ PASSED' : '❌ FAILED');
        
    } catch (error) {
        console.log('❌ LLM service test failed:', error.message);
    }
}

// Test Qdrant service
async function testQdrantService() {
    try {
        const QdrantService = require('./src/services/qdrantService');
        const qdrantService = new QdrantService();
        console.log('✅ Qdrant service loaded');
        
        await qdrantService.initialize();
        console.log('✅ Qdrant service initialized');
        
        const stats = await qdrantService.getCollectionStats();
        console.log('Qdrant collection stats:', stats);
        
    } catch (error) {
        console.log('❌ Qdrant service test failed:', error.message);
        console.log('Error details:', {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
    }
}

// Test chat endpoint simulation
async function testChatEndpoint() {
    console.log('\n💬 Testing Chat Endpoint Simulation:');
    console.log('------------------------------------');
    
    try {
        const llmService = require('./src/services/llm');
        const QdrantService = require('./src/services/qdrantService');
        
        // Simulate the chat request
        const testMessage = "Hello, this is a test message";
        const testUnitName = "Unit 1";
        const testCourseId = "BIOC-202-test";
        
        console.log('Test parameters:', {
            message: testMessage,
            unitName: testUnitName,
            courseId: testCourseId
        });
        
        // Test Qdrant initialization
        const qdrantService = new QdrantService();
        await qdrantService.initialize();
        console.log('✅ Qdrant initialized for chat test');
        
        // Test LLM initialization
        await llmService.initialize();
        console.log('✅ LLM initialized for chat test');
        
        // Test search (if Qdrant is available)
        try {
            const searchResults = await qdrantService.searchDocuments(testMessage, {
                courseId: testCourseId,
                lectureName: testUnitName
            }, 5);
            console.log(`✅ Search test passed: found ${searchResults.length} results`);
        } catch (searchError) {
            console.log('⚠️ Search test failed (continuing without RAG):', searchError.message);
        }
        
        // Test LLM call
        try {
            const response = await llmService.sendMessage(testMessage, {
                temperature: 0.6,
                maxTokens: 400
            });
            console.log('✅ LLM test passed:', {
                responseLength: response.content?.length || 0,
                model: response.model
            });
        } catch (llmError) {
            console.log('❌ LLM test failed:', llmError.message);
        }
        
    } catch (error) {
        console.log('❌ Chat endpoint simulation failed:', error.message);
        console.log('Error details:', {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
    }
}

// Run all tests
async function runTests() {
    await testLLMService();
    await testQdrantService();
    await testChatEndpoint();
    
    console.log('\n📊 Test Summary Complete');
    console.log('========================');
}

runTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
});
