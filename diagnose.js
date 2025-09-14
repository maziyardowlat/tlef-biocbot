#!/usr/bin/env node

/**
 * BiocBot Production Diagnosis Script
 * This script helps diagnose common production issues
 */

require('dotenv').config();

console.log('🔍 BiocBot Production Diagnosis');
console.log('================================\n');

// Check environment variables
console.log('📋 Environment Variables Check:');
const requiredVars = [
    'NODE_ENV',
    'LLM_PROVIDER',
    'OLLAMA_ENDPOINT',
    'OLLAMA_MODEL',
    'QDRANT_URL',
    'MONGO_URI'
];

const missingVars = [];
requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`✅ ${varName}: ${value}`);
    } else {
        console.log(`❌ ${varName}: NOT SET`);
        missingVars.push(varName);
    }
});

if (missingVars.length > 0) {
    console.log(`\n⚠️  Missing required environment variables: ${missingVars.join(', ')}`);
    console.log('Please check your .env file or environment configuration.');
} else {
    console.log('\n✅ All required environment variables are set');
}

// Test service connections
console.log('\n🔌 Service Connection Tests:');

// Test MongoDB
console.log('\n1. Testing MongoDB connection...');
const { MongoClient } = require('mongodb');
async function testMongoDB() {
    try {
        const client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        await client.db().admin().ping();
        console.log('✅ MongoDB: Connected successfully');
        await client.close();
        return true;
    } catch (error) {
        console.log(`❌ MongoDB: Connection failed - ${error.message}`);
        return false;
    }
}

// Test Qdrant
console.log('\n2. Testing Qdrant connection...');
const { QdrantClient } = require('@qdrant/js-client-rest');
async function testQdrant() {
    try {
        const client = new QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333',
            apiKey: process.env.QDRANT_API_KEY || 'super-secret-dev-key'
        });
        await client.getCollections();
        console.log('✅ Qdrant: Connected successfully');
        return true;
    } catch (error) {
        console.log(`❌ Qdrant: Connection failed - ${error.message}`);
        return false;
    }
}

// Test Ollama
console.log('\n3. Testing Ollama connection...');
async function testOllama() {
    try {
        const fetch = require('node-fetch');
        const response = await fetch(`${process.env.OLLAMA_ENDPOINT}/api/tags`);
        if (response.ok) {
            console.log('✅ Ollama: Connected successfully');
            return true;
        } else {
            console.log(`❌ Ollama: Connection failed - HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Ollama: Connection failed - ${error.message}`);
        return false;
    }
}

// Test LLM Service
console.log('\n4. Testing LLM Service...');
async function testLLMService() {
    try {
        const llmService = require('./src/services/llm');
        const isConnected = await llmService.testConnection();
        if (isConnected) {
            console.log('✅ LLM Service: Working correctly');
            return true;
        } else {
            console.log('❌ LLM Service: Connection test failed');
            return false;
        }
    } catch (error) {
        console.log(`❌ LLM Service: Error - ${error.message}`);
        return false;
    }
}

// Run all tests
async function runDiagnosis() {
    const results = await Promise.all([
        testMongoDB(),
        testQdrant(),
        testOllama(),
        testLLMService()
    ]);
    
    const allPassed = results.every(result => result === true);
    
    console.log('\n📊 Diagnosis Summary:');
    console.log('====================');
    
    if (allPassed) {
        console.log('✅ All services are working correctly!');
        console.log('Your BiocBot application should be ready to run.');
    } else {
        console.log('❌ Some services are not working correctly.');
        console.log('Please check the error messages above and fix the issues.');
        console.log('\nCommon fixes:');
        console.log('- Make sure all required services are running');
        console.log('- Check your .env file has all required variables');
        console.log('- Verify network connectivity to external services');
    }
    
    console.log('\nFor more help, check the PRODUCTION_CONFIG.md file.');
}

runDiagnosis().catch(console.error);
