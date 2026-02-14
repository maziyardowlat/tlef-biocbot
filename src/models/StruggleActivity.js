/**
 * Struggle Activity Model
 * Stores persistent history of all struggle state changes (activations/deactivations)
 */

/**
 * Get the struggle activity collection
 * @param {Object} db - MongoDB database instance
 * @returns {Collection} MongoDB collection
 */
function getStruggleActivityCollection(db) {
    return db.collection('struggleActivity');
}

/**
 * Create a new struggle activity entry
 * This is called whenever a student's struggle state changes (active/inactive)
 * @param {Object} db - MongoDB database instance
 * @param {Object} data - Activity data
 * @param {string} data.userId - Student user ID
 * @param {string} data.studentName - Student display name
 * @param {string} data.courseId - Course ID
 * @param {string} data.topic - Topic name (normalized lowercase)
 * @param {string} data.state - "Active" or "Inactive"
 * @param {Date} data.timestamp - When the state change occurred
 * @returns {Promise<Object>} Insert result
 */
async function createActivityEntry(db, data) {
    const collection = getStruggleActivityCollection(db);
    
    const entry = {
        userId: data.userId,
        studentName: data.studentName,
        courseId: data.courseId,
        topic: data.topic,
        state: data.state, // "Active" or "Inactive"
        timestamp: data.timestamp,
        createdAt: new Date() // For potential TTL index
    };
    
    try {
        const result = await collection.insertOne(entry);
        console.log(`📝 [ACTIVITY] Logged ${data.state} for ${data.studentName} - ${data.topic}`);
        return { success: true, insertedId: result.insertedId };
    } catch (error) {
        console.error('❌ Error creating activity entry:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get struggle activity for a specific course
 * Returns most recent entries first
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course ID
 * @param {number} limit - Maximum number of entries to return (default 100)
 * @returns {Promise<Array>} Array of activity entries
 */
async function getActivityByCourse(db, courseId, limit = 100) {
    const collection = getStruggleActivityCollection(db);
    
    try {
        const activities = await collection
            .find({ courseId })
            .sort({ timestamp: -1 }) // Most recent first
            .limit(limit)
            .toArray();
        
        return activities;
    } catch (error) {
        console.error('❌ Error fetching activity by course:', error);
        return [];
    }
}

/**
 * Get struggle activity for a specific student
 * Returns most recent entries first
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - Student user ID
 * @param {number} limit - Maximum number of entries to return (default 50)
 * @returns {Promise<Array>} Array of activity entries
 */
async function getActivityByUser(db, userId, limit = 50) {
    const collection = getStruggleActivityCollection(db);
    
    try {
        const activities = await collection
            .find({ userId })
            .sort({ timestamp: -1 }) // Most recent first
            .limit(limit)
            .toArray();
        
        return activities;
    } catch (error) {
        console.error('❌ Error fetching activity by user:', error);
        return [];
    }
}

/**
 * Create indexes for optimal query performance
 * Should be called during server initialization
 * @param {Object} db - MongoDB database instance
 */
async function createIndexes(db) {
    const collection = getStruggleActivityCollection(db);
    
    try {
        // Index for course queries (most common)
        await collection.createIndex({ courseId: 1, timestamp: -1 });
        
        // Index for user queries
        await collection.createIndex({ userId: 1, timestamp: -1 });
        
        // Optional: TTL index for automatic cleanup after 90 days
        // Uncomment if you want automatic data expiration
        // await collection.createIndex(
        //     { createdAt: 1 },
        //     { expireAfterSeconds: 7776000 } // 90 days
        // );
        
        console.log('✅ Struggle activity indexes created successfully');
    } catch (error) {
        console.error('❌ Error creating struggle activity indexes:', error);
    }
}

module.exports = {
    createActivityEntry,
    getActivityByCourse,
    getActivityByUser,
    createIndexes
};
