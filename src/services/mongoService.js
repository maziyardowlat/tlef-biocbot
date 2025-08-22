/**
 * MongoDB Service
 * Handles database operations and collection management for BiocBot
 */

const { MongoClient } = require('mongodb');

class MongoService {
    constructor() {
        this.client = null;
        this.db = null;
        this.collections = [
            'documents',
            'courses', 
            'onboarding',
            'questions',
            'flaggedQuestions'
        ];
    }

    /**
     * Initialize MongoDB connection
     */
    async initialize() {
        try {
            console.log('🔧 Initializing MongoDB service...');
            
            const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017';
            const dbName = process.env.MONGODB_DB || 'biocbot-dev';
            
            this.client = new MongoClient(mongoUrl);
            await this.client.connect();
            
            this.db = this.client.db(dbName);
            console.log(`✅ Successfully connected to MongoDB: ${dbName}`);
            
        } catch (error) {
            console.error('❌ Failed to initialize MongoDB service:', error);
            throw error;
        }
    }

    /**
     * Delete all BiocBot collections
     * @returns {Promise<Object>} Result of deletion operation
     */
    async deleteAllCollections() {
        try {
            console.log('🗑️ Deleting all BiocBot collections...');
            
            if (!this.db) {
                await this.initialize();
            }

            // Get all collections that actually exist in the database
            const existingCollections = await this.db.listCollections().toArray();
            const collectionNames = existingCollections.map(col => col.name);
            
            console.log(`Found existing collections: ${collectionNames.join(', ')}`);

            const results = {};
            let totalDeleted = 0;

            // Only attempt to delete collections that actually exist
            for (const collectionName of collectionNames) {
                try {
                    const collection = this.db.collection(collectionName);
                    
                    // Get collection stats before deletion
                    const stats = await collection.stats();
                    const documentCount = stats.count || 0;
                    
                    // Delete the collection
                    await this.db.dropCollection(collectionName);
                    console.log(`✅ Deleted collection: ${collectionName} (${documentCount} documents)`);
                    
                    results[collectionName] = { 
                        exists: true, 
                        deleted: documentCount,
                        success: true 
                    };
                    totalDeleted += documentCount;
                    
                } catch (error) {
                    console.error(`❌ Error deleting collection ${collectionName}:`, error);
                    results[collectionName] = { 
                        exists: true, 
                        deleted: 0,
                        success: false,
                        error: error.message 
                    };
                }
            }

            console.log(`✅ Completed deletion of BiocBot collections. Total documents removed: ${totalDeleted}`);

            return {
                success: true,
                message: 'All BiocBot collections deleted successfully',
                results,
                totalDeleted
            };

        } catch (error) {
            console.error('❌ Error deleting collections:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if a collection exists
     * @param {string} collectionName - Name of the collection to check
     * @returns {Promise<boolean>} Whether the collection exists
     */
    async collectionExists(collectionName) {
        try {
            const collections = await this.db.listCollections({ name: collectionName }).toArray();
            return collections.length > 0;
        } catch (error) {
            console.error(`Error checking if collection ${collectionName} exists:`, error);
            return false;
        }
    }

    /**
     * Get database statistics
     * @returns {Promise<Object>} Database statistics
     */
    async getDatabaseStats() {
        try {
            if (!this.db) {
                await this.initialize();
            }

            const stats = {};
            
            for (const collectionName of this.collections) {
                try {
                    const exists = await this.collectionExists(collectionName);
                    if (exists) {
                        const collection = this.db.collection(collectionName);
                        const collectionStats = await collection.stats();
                        stats[collectionName] = {
                            exists: true,
                            documentCount: collectionStats.count || 0,
                            size: collectionStats.size || 0
                        };
                    } else {
                        stats[collectionName] = {
                            exists: false,
                            documentCount: 0,
                            size: 0
                        };
                    }
                } catch (error) {
                    stats[collectionName] = {
                        exists: false,
                        documentCount: 0,
                        size: 0,
                        error: error.message
                    };
                }
            }

            return {
                success: true,
                data: stats
            };

        } catch (error) {
            console.error('❌ Error getting database stats:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Close MongoDB connection
     */
    async close() {
        if (this.client) {
            await this.client.close();
            console.log('✅ MongoDB connection closed');
        }
    }
}

module.exports = MongoService;
