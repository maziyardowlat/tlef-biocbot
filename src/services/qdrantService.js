/**
 * Qdrant Service
 * Handles vector database operations for document embeddings and semantic search
 */

const { QdrantClient } = require('@qdrant/js-client-rest');
const { EmbeddingsModule } = require('ubc-genai-toolkit-embeddings');
const { ConsoleLogger } = require('ubc-genai-toolkit-core');
const { randomUUID } = require('crypto');

console.log('✅ Successfully imported embeddings library:', typeof EmbeddingsModule);

class QdrantService {
    constructor() {
        this.client = null;
        this.embeddings = null;
        this.collectionName = 'biocbot_documents';
        this.vectorSize = 768; // nomic-embed-text model dimension
    }

    /**
     * Initialize Qdrant client and embeddings service
     */
    async initialize() {
        try {
            console.log('🔧 Initializing Qdrant service...');
            
            // Initialize Qdrant client
            this.client = new QdrantClient({
                url: process.env.QDRANT_URL || 'http://localhost:6333',
                apiKey: process.env.QDRANT_API_KEY || 'super-secret-dev-key'
            });

            // Test Qdrant connection
            console.log('Testing Qdrant connection...');
            await this.client.getCollections();
            console.log('✅ Successfully connected to Qdrant');

            // Initialize embeddings service
            console.log('Initializing embeddings service...');
            
            // Use the correct initialization pattern from the example app
            const logger = new ConsoleLogger('biocbot-qdrant');
            
            const llmConfig = {
                provider: process.env.LLM_PROVIDER || 'ollama',
                apiKey: process.env.LLM_API_KEY || 'nokey',
                endpoint: process.env.LLM_ENDPOINT || 'http://localhost:11434',
                defaultModel: process.env.LLM_DEFAULT_MODEL || 'llama3.1',
                embeddingModel: process.env.LLM_EMBEDDING_MODEL || 'nomic-embed-text',
            };

            const config = {
                providerType: process.env.EMBEDDING_PROVIDER || 'ubc-genai-toolkit-llm',
                logger: logger,
                llmConfig: llmConfig,
            };

            this.embeddings = await EmbeddingsModule.create(config);
            console.log('✅ Successfully initialized embeddings service');

            // Test embeddings service with a simple text
            console.log('Testing embeddings service...');
            const testEmbedding = await this.embeddings.embed('test');
            if (!testEmbedding || !Array.isArray(testEmbedding)) {
                throw new Error('Embeddings service returned invalid result');
            }
            console.log(`✅ Successfully initialized embeddings service (test embedding: ${testEmbedding.length} dimensions)`);

            // Ensure collection exists
            await this.ensureCollectionExists();

        } catch (error) {
            console.error('❌ Failed to initialize Qdrant service:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            throw error;
        }
    }

    /**
     * Ensure the documents collection exists in Qdrant
     */
    async ensureCollectionExists() {
        try {
            const collections = await this.client.getCollections();
            const collectionExists = collections.collections.some(
                col => col.name === this.collectionName
            );

            if (!collectionExists) {
                console.log(`Creating collection: ${this.collectionName}`);
                
                await this.client.createCollection(this.collectionName, {
                    vectors: {
                        size: this.vectorSize,
                        distance: 'Cosine'
                    }
                });

                console.log(`✅ Collection ${this.collectionName} created successfully`);
            } else {
                console.log(`✅ Collection ${this.collectionName} already exists`);
            }
        } catch (error) {
            console.error('❌ Error ensuring collection exists:', error);
            throw error;
        }
    }

    /**
     * Process and store a document in Qdrant
     * @param {Object} documentData - Document information
     * @param {string} documentData.courseId - Course ID
     * @param {string} documentData.lectureName - Lecture/Unit name
     * @param {string} documentData.documentId - Document ID
     * @param {string} documentData.content - Document text content
     * @param {string} documentData.fileName - Original filename
     * @param {string} documentData.mimeType - File MIME type
     * @returns {Promise<Object>} Result of document processing
     */
    async processAndStoreDocument(documentData) {
        try {
            console.log(`Processing document: ${documentData.fileName} for ${documentData.lectureName}`);
            console.log(`Document content length: ${documentData.content ? documentData.content.length : 'undefined'} characters`);
            
            // Validate input
            if (!documentData.content || typeof documentData.content !== 'string') {
                throw new Error('Invalid document content: content must be a non-empty string');
            }
            
            if (documentData.content.trim().length === 0) {
                throw new Error('Document content is empty or contains only whitespace');
            }

            // Sanitize content - remove any non-printable characters that might cause issues
            let sanitizedContent = documentData.content
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
                .replace(/\r\n/g, '\n') // Normalize line endings
                .replace(/\r/g, '\n'); // Convert remaining carriage returns
            
            // Check if content looks reasonable
            if (sanitizedContent.length < 10) {
                throw new Error('Document content is too short to process meaningfully');
            }
            
            // Check for suspicious patterns (like repeated characters)
            const suspiciousPattern = /(.)\1{10,}/; // Same character repeated 10+ times
            if (suspiciousPattern.test(sanitizedContent)) {
                console.warn('⚠️ Document content contains suspicious patterns (repeated characters)');
                // Clean up the suspicious patterns
                sanitizedContent = sanitizedContent.replace(/(.)\1{10,}/g, '$1$1$1');
            }
            
            console.log(`Sanitized content length: ${sanitizedContent.length} characters`);
            console.log(`Content preview: "${sanitizedContent.substring(0, 100)}..."`);

            // Chunk the document content
            const chunks = this.chunkDocument(sanitizedContent);
            console.log(`Created ${chunks.length} chunks from document`);
            
            if (chunks.length === 0) {
                throw new Error('No chunks were created from the document content');
            }

            // Generate embeddings for each chunk
            const embeddings = await this.generateEmbeddings(chunks);
            console.log(`Generated embeddings for ${embeddings.length} chunks`);
            
            if (embeddings.length === 0) {
                throw new Error('No embeddings were generated for the document chunks');
            }

            // Store chunks and embeddings in Qdrant
            const storedChunks = await this.storeChunks(documentData, chunks, embeddings);
            console.log(`Stored ${storedChunks.length} chunks in Qdrant`);

            return {
                success: true,
                chunksProcessed: chunks.length,
                chunksStored: storedChunks.length,
                message: `Document processed and ${storedChunks.length} chunks stored successfully`
            };

        } catch (error) {
            console.error('❌ Error processing document:', error);
            console.error('Document data:', {
                fileName: documentData.fileName,
                lectureName: documentData.lectureName,
                contentLength: documentData.content ? documentData.content.length : 'undefined',
                contentPreview: documentData.content ? documentData.content.substring(0, 100) + '...' : 'undefined'
            });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Chunk document content into smaller pieces for better embedding
     * @param {string} content - Document text content
     * @param {number} chunkSize - Maximum chunk size in characters
     * @param {number} overlap - Overlap between chunks in characters
     * @returns {Array<string>} Array of text chunks
     */
    chunkDocument(content, chunkSize = 1000, overlap = 200) {
        if (!content || typeof content !== 'string') {
            console.warn('Invalid content provided to chunkDocument, returning empty array');
            return [];
        }

        if (content.trim().length === 0) {
            console.warn('Empty content provided to chunkDocument, returning empty array');
            return [];
        }

        console.log(`Chunking document: ${content.length} characters, chunk size: ${chunkSize}, overlap: ${overlap}`);
        
        const chunks = [];
        let currentPosition = 0;
        const maxIterations = Math.ceil(content.length / (chunkSize - overlap)) + 10; // Safety limit
        let iterationCount = 0;

        while (currentPosition < content.length && iterationCount < maxIterations) {
            iterationCount++;
            
            // Calculate the end position for this chunk
            let endPosition = Math.min(currentPosition + chunkSize, content.length);
            
            // Extract the chunk
            let chunk = content.substring(currentPosition, endPosition);
            
            // Try to find a good break point near the end
            if (endPosition < content.length && chunk.length > chunkSize * 0.8) {
                // Look for sentence endings in the last 20% of the chunk
                const searchStart = Math.max(currentPosition + Math.floor(chunkSize * 0.8), currentPosition);
                const searchEnd = endPosition;
                const searchText = content.substring(searchStart, searchEnd);
                
                const lastPeriod = searchText.lastIndexOf('.');
                const lastQuestion = searchText.lastIndexOf('?');
                const lastExclamation = searchText.lastIndexOf('!');
                const lastBreak = Math.max(lastPeriod, lastQuestion, lastExclamation);
                
                if (lastBreak > 0) {
                    // Found a good break point
                    const actualEnd = searchStart + lastBreak + 1;
                    chunk = content.substring(currentPosition, actualEnd);
                    endPosition = actualEnd;
                }
            }
            
            // Ensure the chunk is valid
            if (chunk && chunk.trim().length > 0) {
                const trimmedChunk = chunk.trim();
                if (trimmedChunk.length > 0) {
                    chunks.push(trimmedChunk);
                    console.log(`Created chunk ${chunks.length}: ${trimmedChunk.length} characters`);
                }
            }
            
            // Move to next position
            if (endPosition <= currentPosition) {
                // Safety check - if we're not making progress, force advancement
                currentPosition = Math.min(currentPosition + chunkSize, content.length);
            } else {
                currentPosition = endPosition - overlap;
            }
            
            // Ensure we don't go backwards
            if (currentPosition < 0) {
                currentPosition = 0;
            }
        }
        
        console.log(`Chunking complete: created ${chunks.length} chunks`);
        return chunks;
    }

    /**
     * Generate embeddings for text chunks
     * @param {Array<string>} chunks - Array of text chunks
     * @returns {Promise<Array<Array<number>>>} Array of embedding vectors
     */
    async generateEmbeddings(chunks) {
        try {
            if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
                throw new Error('Invalid chunks array provided to generateEmbeddings');
            }
            
            console.log(`Generating embeddings for ${chunks.length} chunks...`);
            const embeddings = [];
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunk.substring(0, 50)}..."`);
                
                if (!chunk || typeof chunk !== 'string' || chunk.trim().length === 0) {
                    console.warn(`Skipping empty chunk ${i + 1}`);
                    continue;
                }
                
                try {
                    const embedding = await this.embeddings.embed(chunk);
                    
                    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
                        throw new Error(`Invalid embedding returned for chunk ${i + 1}: ${typeof embedding}`);
                    }
                    
                    // The embed method returns an array, we want the first (and only) embedding
                    const embeddingVector = embedding[0];
                    if (!Array.isArray(embeddingVector)) {
                        throw new Error(`Embedding vector is not an array for chunk ${i + 1}: ${typeof embeddingVector}`);
                    }
                    
                    if (embeddingVector.length !== this.vectorSize) {
                        console.warn(`Warning: Chunk ${i + 1} embedding size (${embeddingVector.length}) doesn't match expected size (${this.vectorSize})`);
                    }
                    
                    embeddings.push(embeddingVector);
                    console.log(`✅ Generated embedding for chunk ${i + 1}: ${embeddingVector.length} dimensions`);
                    
                } catch (chunkError) {
                    console.error(`❌ Error generating embedding for chunk ${i + 1}:`, chunkError);
                    throw new Error(`Failed to generate embedding for chunk ${i + 1}: ${chunkError.message}`);
                }
            }
            
            console.log(`Successfully generated ${embeddings.length} embeddings`);
            return embeddings;
            
        } catch (error) {
            console.error('❌ Error generating embeddings:', error);
            throw error;
        }
    }

    /**
     * Store document chunks and embeddings in Qdrant
     * @param {Object} documentData - Document metadata
     * @param {Array<string>} chunks - Text chunks
     * @param {Array<Array<number>>} embeddings - Embedding vectors
     * @returns {Promise<Array<Object>>} Array of stored chunk IDs
     */
    async storeChunks(documentData, chunks, embeddings) {
        try {
            const points = [];
            const storedChunks = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunkId = randomUUID();
                
                const point = {
                    id: chunkId,
                    vector: embeddings[i],
                    payload: {
                        courseId: documentData.courseId,
                        lectureName: documentData.lectureName,
                        documentId: documentData.documentId,
                        fileName: documentData.fileName,
                        mimeType: documentData.mimeType,
                        chunkIndex: i,
                        chunkText: chunks[i],
                        chunkLength: chunks[i].length,
                        timestamp: new Date().toISOString()
                    }
                };

                points.push(point);
                storedChunks.push({ 
                    id: chunkId, 
                    chunkIndex: i,
                    documentId: documentData.documentId,
                    chunkText: chunks[i].substring(0, 50) + '...' // First 50 chars for reference
                });
            }

            // Upsert points to Qdrant
            await this.client.upsert(this.collectionName, {
                points: points
            });

            return storedChunks;

        } catch (error) {
            console.error('❌ Error storing chunks in Qdrant:', error);
            throw error;
        }
    }

    /**
     * Search for relevant document chunks using semantic similarity
     * @param {string} query - Search query text
     * @param {Object} filters - Optional filters for search
     * @param {number} limit - Maximum number of results to return
     * @returns {Promise<Array<Object>>} Array of search results
     */
    async searchDocuments(query, filters = {}, limit = 10) {
        try {
            console.log(`Searching for: "${query}"`);

            // Generate embedding for the search query
            const queryEmbedding = await this.embeddings.embed(query);

            // Build search parameters
            const searchParams = {
                vector: queryEmbedding,
                limit: limit,
                with_payload: true,
                with_vector: false
            };

            // Add filters if provided
            if (filters.courseId) {
                searchParams.filter = {
                    must: [
                        {
                            key: 'courseId',
                            match: { value: filters.courseId }
                        }
                    ]
                };
            }

            if (filters.lectureName) {
                if (!searchParams.filter) {
                    searchParams.filter = { must: [] };
                }
                searchParams.filter.must.push({
                    key: 'lectureName',
                    match: { value: filters.lectureName }
                });
            }

            // Perform search
            const searchResults = await this.client.search(
                this.collectionName,
                searchParams
            );

            console.log(`Found ${searchResults.length} relevant chunks`);

            // Transform results to a more useful format
            const transformedResults = searchResults.map(result => ({
                id: result.id,
                score: result.score,
                courseId: result.payload.courseId,
                lectureName: result.payload.lectureName,
                documentId: result.payload.documentId,
                fileName: result.payload.fileName,
                chunkText: result.payload.chunkText,
                chunkIndex: result.payload.chunkIndex,
                timestamp: result.payload.timestamp
            }));

            return transformedResults;

        } catch (error) {
            console.error('❌ Error searching documents:', error);
            throw error;
        }
    }

    /**
     * Delete all chunks for a specific document
     * @param {string} documentId - Document ID to delete
     * @returns {Promise<Object>} Result of deletion
     */
    async deleteDocumentChunks(documentId) {
        try {
            console.log(`Deleting chunks for document: ${documentId}`);

            // Find all chunks for this document
            const chunks = await this.client.scroll(this.collectionName, {
                filter: {
                    must: [
                        {
                            key: 'documentId',
                            match: { value: documentId }
                        }
                    ]
                },
                limit: 1000,
                with_payload: false
            });

            if (chunks.points.length === 0) {
                return {
                    success: true,
                    message: 'No chunks found for document',
                    deletedCount: 0
                };
            }

            // Delete the chunks
            const chunkIds = chunks.points.map(point => point.id);
            await this.client.delete(this.collectionName, {
                points: chunkIds
            });

            console.log(`Deleted ${chunkIds.length} chunks for document: ${documentId}`);

            return {
                success: true,
                message: `Deleted ${chunkIds.length} chunks successfully`,
                deletedCount: chunkIds.length
            };

        } catch (error) {
            console.error('❌ Error deleting document chunks:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get collection statistics
     * @returns {Promise<Object>} Collection statistics
     */
    async getCollectionStats() {
        try {
            const collectionInfo = await this.client.getCollection(this.collectionName);
            const collectionStats = await this.client.getCollection(this.collectionName);
            
            return {
                name: collectionInfo.name,
                vectorSize: collectionInfo.config.params.vectors.size,
                distance: collectionInfo.config.params.vectors.distance,
                pointsCount: collectionStats.points_count,
                segmentsCount: collectionStats.segments_count,
                status: collectionInfo.status
            };
        } catch (error) {
            console.error('❌ Error getting collection stats:', error);
            throw error;
        }
    }
}

module.exports = QdrantService;
