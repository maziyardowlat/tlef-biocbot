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

/**
 * Get weekly active struggle topics aggregated by ISO week
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {Object} options - Query options
 * @param {number} options.weeks - Number of weeks to look back (default: 8)
 * @returns {Promise<Array>} Array of weekly data sorted chronologically
 */
async function getWeeklyActiveTopics(db, courseId, options = {}) {
    const collection = getStruggleActivityCollection(db);
    const weeks = options.weeks || 8;

    // Calculate start date (beginning of the week, `weeks` weeks ago)
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (weeks * 7));
    // Snap to Monday of that week
    const day = startDate.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = 1
    startDate.setDate(startDate.getDate() + diff);
    startDate.setHours(0, 0, 0, 0);

    const pipeline = [
        {
            $match: {
                courseId,
                state: 'Active',
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    weekStart: {
                        $dateFromParts: {
                            isoWeekYear: { $isoWeekYear: '$timestamp' },
                            isoWeek: { $isoWeek: '$timestamp' },
                            isoDayOfWeek: 1
                        }
                    },
                    topic: { $toLower: '$topic' }
                },
                uniqueStudents: { $addToSet: '$userId' }
            }
        },
        {
            $project: {
                _id: 0,
                weekStart: '$_id.weekStart',
                topic: '$_id.topic',
                studentCount: { $size: '$uniqueStudents' }
            }
        },
        {
            $group: {
                _id: '$weekStart',
                topics: { $push: { topic: '$topic', studentCount: '$studentCount' } },
                totalCount: { $sum: '$studentCount' }
            }
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                weekStart: '$_id',
                topics: 1,
                totalCount: 1
            }
        }
    ];

    return await collection.aggregate(pipeline).toArray();
}

module.exports = {
    createActivityEntry,
    getActivityByCourse,
    getActivityByStudent,
    getWeeklyActiveTopics
};
