#!/usr/bin/env node

/**
 * Production Environment Diagnostic Script
 * Checks all required services and configurations for production deployment
 */

require('dotenv').config();

console.log('🔍 BiocBot Production Environment Diagnostic');
console.log('==========================================\n');

// Check environment variables
console.log('📋 Environment Variables:');
console.log('-------------------------');
const requiredVars = [
    'NODE_ENV',
    'MONGO_URI',
    'TLEF_BIOCBOT_PORT',
    'LLM_PROVIDER',
    'OLLAMA_ENDPOINT',
    'OLLAMA_MODEL',
    'QDRANT_URL',
    'LLM_EMBEDDING_MODEL'
];

requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        // Mask sensitive values
        const displayValue = varName.includes('KEY') || varName.includes('URI') || varName.includes('SECRET') 
            ? '***MASKED***' 
            : value;
        console.log(`✅ ${varName}: ${displayValue}`);
    } else {
        console.log(`❌ ${varName}: NOT SET`);
    }
});

console.log('\n🔧 Service Configuration:');
console.log('-------------------------');

// Test MongoDB connection
async function testMongoDB() {
    try {
        const { MongoClient } = require('mongodb');
        const mongoUri = process.env.MONGO_URI;
        
        if (!mongoUri) {
            console.log('❌ MongoDB: MONGO_URI not set');
            return false;
        }
        
        const client = new MongoClient(mongoUri);
        await client.connect();
        await client.db().admin().ping();
        await client.close();
        
        console.log('✅ MongoDB: Connection successful');
        return true;
    } catch (error) {
        console.log(`❌ MongoDB: ${error.message}`);
        return false;
    }
}

// Test Qdrant connection
async function testQdrant() {
    try {
        const { QdrantClient } = require('@qdrant/js-client-rest');
        
        const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        const qdrantApiKey = process.env.QDRANT_API_KEY || 'super-secret-dev-key';
        
        const client = new QdrantClient({
            url: qdrantUrl,
            apiKey: qdrantApiKey
        });
        
        await client.getCollections();
        console.log('✅ Qdrant: Connection successful');
        return true;
    } catch (error) {
        console.log(`❌ Qdrant: ${error.message}`);
        return false;
    }
}

// Test Ollama connection
async function testOllama() {
    try {
        const ollamaEndpoint = process.env.OLLAMA_ENDPOINT;
        
        if (!ollamaEndpoint) {
            console.log('❌ Ollama: OLLAMA_ENDPOINT not set');
            return false;
        }
        
        const response = await fetch(`${ollamaEndpoint}/api/tags`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ Ollama: Connection successful');
        console.log(`   Available models: ${data.models?.map(m => m.name).join(', ') || 'None'}`);
        return true;
    } catch (error) {
        console.log(`❌ Ollama: ${error.message}`);
        return false;
    }
}

// Test LLM service initialization
async function testLLMService() {
    try {
        const llmService = require('./src/services/llm');
        
        // Test connection
        const isConnected = await llmService.testConnection();
        
        if (isConnected) {
            console.log('✅ LLM Service: Connection successful');
            console.log(`   Provider: ${llmService.getProviderName()}`);
            return true;
        } else {
            console.log('❌ LLM Service: Connection failed');
            return false;
        }
    } catch (error) {
        console.log(`❌ LLM Service: ${error.message}`);
        return false;
    }
}

// Test Qdrant service initialization
async function testQdrantService() {
    try {
        const QdrantService = require('./src/services/qdrantService');
        const qdrantService = new QdrantService();
        
        await qdrantService.initialize();
        
        const stats = await qdrantService.getCollectionStats();
        console.log('✅ Qdrant Service: Initialization successful');
        console.log(`   Collection: ${stats.name} (${stats.pointsCount} points)`);
        return true;
    } catch (error) {
        console.log(`❌ Qdrant Service: ${error.message}`);
        return false;
    }
}

// Run all tests
async function runDiagnostics() {
    const results = {
        mongodb: await testMongoDB(),
        qdrant: await testQdrant(),
        ollama: await testOllama(),
        llmService: await testLLMService(),
        qdrantService: await testQdrantService()
    };
    
    console.log('\n📊 Summary:');
    console.log('------------');
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('🎉 All services are working correctly!');
        process.exit(0);
    } else {
        console.log('⚠️  Some services are not working. Check the errors above.');
        process.exit(1);
    }
}

// Add fetch polyfill for Node.js
if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
}

runDiagnostics().catch(error => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
});
