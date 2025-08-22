/**
 * Qdrant API Routes
 * Handles document processing, embedding, and semantic search operations
 */

const express = require('express');
const router = express.Router();
const QdrantService = require('../services/qdrantService');

// Initialize Qdrant service
const qdrantService = new QdrantService();

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * GET /api/qdrant/status
 * Get Qdrant service status and collection statistics
 */
router.get('/status', async (req, res) => {
    try {
        // Ensure service is initialized
        if (!qdrantService.client) {
            await qdrantService.initialize();
        }

        const stats = await qdrantService.getCollectionStats();
        
        res.json({
            success: true,
            data: {
                status: 'connected',
                collection: stats,
                service: 'Qdrant Vector Database'
            }
        });

    } catch (error) {
        console.error('Error getting Qdrant status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get Qdrant status',
            error: error.message
        });
    }
});

/**
 * POST /api/qdrant/process-document
 * Process a document: chunk, embed, and store in Qdrant
 */
router.post('/process-document', async (req, res) => {
    try {
        const { 
            courseId, 
            lectureName, 
            documentId, 
            content, 
            fileName, 
            mimeType 
        } = req.body;

        // Validate required fields
        if (!courseId || !lectureName || !documentId || !content || !fileName) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, lectureName, documentId, content, fileName'
            });
        }

        // Ensure service is initialized
        if (!qdrantService.client) {
            await qdrantService.initialize();
        }

        // Process and store document
        const result = await qdrantService.processAndStoreDocument({
            courseId,
            lectureName,
            documentId,
            content,
            fileName,
            mimeType: mimeType || 'text/plain'
        });

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: {
                    chunksProcessed: result.chunksProcessed,
                    chunksStored: result.chunksStored,
                    documentId,
                    courseId,
                    lectureName
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to process document',
                error: result.error
            });
        }

    } catch (error) {
        console.error('Error processing document:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while processing document',
            error: error.message
        });
    }
});

/**
 * POST /api/qdrant/search
 * Search for relevant document chunks using semantic similarity
 */
router.post('/search', async (req, res) => {
    try {
        const { query, courseId, lectureName, limit = 10 } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }

        // Ensure service is initialized
        if (!qdrantService.client) {
            await qdrantService.initialize();
        }

        // Build filters
        const filters = {};
        if (courseId) filters.courseId = courseId;
        if (lectureName) filters.lectureName = lectureName;

        // Perform search
        const searchResults = await qdrantService.searchDocuments(query, filters, limit);

        res.json({
            success: true,
            data: {
                query,
                results: searchResults,
                totalResults: searchResults.length,
                filters
            }
        });

    } catch (error) {
        console.error('Error searching documents:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while searching',
            error: error.message
        });
    }
});

/**
 * DELETE /api/qdrant/document/:documentId
 * Delete all chunks for a specific document
 */
router.delete('/document/:documentId', async (req, res) => {
    try {
        const { documentId } = req.params;

        if (!documentId) {
            return res.status(400).json({
                success: false,
                message: 'Document ID is required'
            });
        }

        // Ensure service is initialized
        if (!qdrantService.client) {
            await qdrantService.initialize();
        }

        // Delete document chunks
        const result = await qdrantService.deleteDocumentChunks(documentId);

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: {
                    documentId,
                    deletedCount: result.deletedCount
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to delete document chunks',
                error: result.error
            });
        }

    } catch (error) {
        console.error('Error deleting document chunks:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting document',
            error: error.message
        });
    }
});

/**
 * GET /api/qdrant/collection-stats
 * Get detailed collection statistics
 */
router.get('/collection-stats', async (req, res) => {
    try {
        // Ensure service is initialized
        if (!qdrantService.client) {
            await qdrantService.initialize();
        }

        const stats = await qdrantService.getCollectionStats();
        
        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('Error getting collection stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get collection statistics',
            error: error.message
        });
    }
});

/**
 * DELETE /api/qdrant/collection
 * Delete the entire collection (DANGEROUS - removes all data)
 */
router.delete('/collection', async (req, res) => {
    try {
        // Ensure service is initialized
        if (!qdrantService.client) {
            await qdrantService.initialize();
        }

        // Delete the entire collection
        const result = await qdrantService.deleteCollection();

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: {
                    deletedCount: result.deletedCount
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to delete collection',
                error: result.error
            });
        }

    } catch (error) {
        console.error('Error deleting collection:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting collection',
            error: error.message
        });
    }
});

/**
 * DELETE /api/qdrant/delete-all-collections
 * Delete all collections (Qdrant, MongoDB)
 */
router.delete('/delete-all-collections', async (req, res) => {
    try {
        // Delete Qdrant collection
        const qdrantResult = await qdrantService.deleteCollection();
        if (!qdrantResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete Qdrant collection',
                error: qdrantResult.error
            });
        }

        // Delete MongoDB collections using existing connection
        const db = req.app.locals.db;
        if (!db) {
            return res.status(500).json({
                success: false,
                message: 'Database connection not available',
                error: 'Database not initialized'
            });
        }

        console.log('🗑️ Deleting all MongoDB collections...');
        
        // Get all collections that actually exist in the database
        const existingCollections = await db.listCollections().toArray();
        const collectionNames = existingCollections.map(col => col.name);
        
        console.log(`Found existing collections: ${collectionNames.join(', ')}`);

        const mongoResults = {};
        let totalDeleted = 0;

        // Delete each existing collection
        for (const collectionName of collectionNames) {
            try {
                const collection = db.collection(collectionName);
                
                // Get collection document count before deletion
                const documentCount = await collection.countDocuments();
                
                // Delete the collection
                await db.dropCollection(collectionName);
                console.log(`✅ Deleted collection: ${collectionName} (${documentCount} documents)`);
                
                mongoResults[collectionName] = { 
                    exists: true, 
                    deleted: documentCount,
                    success: true 
                };
                totalDeleted += documentCount;
                
            } catch (error) {
                console.error(`❌ Error deleting collection ${collectionName}:`, error);
                mongoResults[collectionName] = { 
                    exists: true, 
                    deleted: 0,
                    success: false,
                    error: error.message 
                };
            }
        }

        console.log(`✅ Completed deletion of MongoDB collections. Total documents removed: ${totalDeleted}`);

        res.json({
            success: true,
            message: 'All collections deleted successfully',
            data: {
                qdrantDeletedCount: qdrantResult.deletedCount,
                mongoDeletedCount: totalDeleted,
                mongoResults: mongoResults
            }
        });

    } catch (error) {
        console.error('Error deleting all collections:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting all collections',
            error: error.message
        });
    }
});

module.exports = router;



