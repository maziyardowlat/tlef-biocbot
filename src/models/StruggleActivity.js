/**
 * StruggleActivity Model
 * 
 * Handles persistent storage of student struggle activity logs in MongoDB.
 * Each entry represents a state change (Active/Inactive) for a topic.
 */

const COLLECTION_NAME = 'struggleActivity';

/**
 * Get the struggle activity collection
 * @param {Object} db - MongoDB database instance
 * @returns {Collection} MongoDB collection
 */
function getStruggleActivityCollection(db) {
    return db.collection(COLLECTION_NAME);
}

/**
 * Create a new activity entry in MongoDB
 * @param {Object} db - MongoDB database instance
 * @param {Object} data - Activity data
 * @param {string} data.userId - User identifier
 * @param {string} data.studentName - Student display name
 * @param {string} data.courseId - Course identifier
 * @param {string} data.topic - Topic name
 * @param {string} data.state - 'Active' or 'Inactive'
 * @param {Date} data.timestamp - Timestamp of state change
 * @returns {Promise<Object>} Insert result
 */
async function createActivityEntry(db, data) {
    const collection = getStruggleActivityCollection(db);
    
    const entry = {
        userId: data.userId,
        studentName: data.studentName,
        courseId: data.courseId,
        topic: data.topic.toLowerCase().trim(),
        state: data.state,
        timestamp: data.timestamp || new Date(),
        createdAt: new Date()
    };
    
    const result = await collection.insertOne(entry);
    console.log(`📝 [STRUGGLE_ACTIVITY] Created ${entry.state} entry for ${entry.studentName} - Topic: ${entry.topic}`);
    
    return result;
}

/**
 * Get struggle activity for a course
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of entries to return (default: 100)
 * @param {string} options.state - Filter by state ('Active' or 'Inactive')
 * @returns {Promise<Array>} Array of activity entries, sorted by timestamp (newest first)
 */
async function getActivityByCourse(db, courseId, options = {}) {
    const collection = getStruggleActivityCollection(db);
    const limit = options.limit || 100;
    
    const query = { courseId };
    if (options.state) {
        query.state = options.state;
    }
    
    const activities = await collection
        .find(query)
        .sort({ timestamp: -1 }) // Newest first
        .limit(limit)
        .toArray();
    
    return activities;
}

/**
 * Get struggle activity for a specific student
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User identifier
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of entries to return
 * @returns {Promise<Array>} Array of activity entries for the student
 */
async function getActivityByStudent(db, userId, options = {}) {
    const collection = getStruggleActivityCollection(db);
    const limit = options.limit || 50;
    
    const activities = await collection
        .find({ userId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    
    return activities;
}

module.exports = {
    createActivityEntry,
    getActivityByCourse,
    getActivityByStudent
};
