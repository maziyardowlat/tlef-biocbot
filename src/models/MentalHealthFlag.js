const { createId } = require('../services/id');

/**
 * Mental Health Flag Model for MongoDB
 * Stores AI-detected mental health concern flags from student conversations.
 * These flags are invisible to students and only shown to instructors/admins.
 */

/**
 * Mental Health Flag Schema Structure:
 * {
 *   _id: ObjectId,
 *   flagId: String,              // Unique flag identifier "mhf_<timestamp>_<random>"
 *   studentId: String,           // ID of the student
 *   studentName: String,         // Name of the student (visible only to admins)
 *   courseId: String,            // Course where the flag was raised
 *   unitName: String,            // Unit/lecture context
 *   message: String,             // The student message that triggered the flag
 *   conversationContext: Array,  // Full conversation history [{role, content}]
 *   concernLevel: String,        // "low concern" | "high concern"
 *   llmReason: String,           // The LLM's brief explanation for the flag
 *   status: String,              // "pending" | "escalated" | "dismissed" | "resolved" | "disregarded"
 *   escalatedBy: String,         // Instructor ID who escalated
 *   escalatedAt: Date,           // When escalation occurred
 *   resolvedBy: String,          // Admin ID who resolved/disregarded
 *   resolvedAt: Date,            // When resolution occurred
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */

/**
 * Get the mental health flags collection
 * @param {Object} db - MongoDB database instance
 * @returns {Collection}
 */
function getCollection(db) {
    return db.collection('mentalHealthFlags');
}

/** Every status a flag can hold, in the order the statistics object reports them. */
const FLAG_STATUSES = ['pending', 'escalated', 'dismissed', 'resolved', 'disregarded'];

/**
 * Create a new mental health flag
 * @param {Object} db - MongoDB database instance
 * @param {Object} flagData - Flag data
 * @returns {Promise<Object>}
 */
async function createMentalHealthFlag(db, flagData) {
    const collection = getCollection(db);
    const now = new Date();
    const flagId = createId('mhf');

    const flag = {
        flagId,
        studentId: flagData.studentId,
        studentName: flagData.studentName || 'Unknown Student',
        courseId: flagData.courseId,
        unitName: flagData.unitName || 'Unknown Unit',
        message: flagData.message,
        conversationContext: flagData.conversationContext || [],
        concernLevel: flagData.concernLevel,
        llmReason: flagData.llmReason || '',
        status: 'pending',
        escalatedBy: null,
        escalatedAt: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now
    };

    const result = await collection.insertOne(flag);
    console.log(`Mental health flag created: ${flagId} (${flagData.concernLevel}) for course ${flagData.courseId}`);

    return {
        success: true,
        flagId,
        insertedId: result.insertedId
    };
}

/**
 * Get mental health flags for a course
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} status - Optional status filter
 * @returns {Promise<Array>}
 */
async function getMentalHealthFlagsForCourse(db, courseId, status = null) {
    const collection = getCollection(db);
    const filter = { courseId };
    if (status && status !== 'all') {
        filter.status = status;
    }
    return collection.find(filter).sort({ createdAt: -1 }).toArray();
}

/**
 * Update flag status (escalate, dismiss, resolve, disregard)
 * @param {Object} db - MongoDB database instance
 * @param {string} flagId - Flag identifier
 * @param {string} newStatus - New status
 * @param {string} userId - ID of user making the change
 * @returns {Promise<Object>}
 */
async function updateFlagStatus(db, flagId, newStatus, userId) {
    const collection = getCollection(db);
    const now = new Date();

    const updateData = {
        status: newStatus,
        updatedAt: now
    };

    if (newStatus === 'escalated') {
        updateData.escalatedBy = userId;
        updateData.escalatedAt = now;
    }
    if (newStatus === 'resolved' || newStatus === 'disregarded') {
        updateData.resolvedBy = userId;
        updateData.resolvedAt = now;
    }

    const result = await collection.updateOne(
        { flagId },
        { $set: updateData }
    );

    if (result.modifiedCount > 0) {
        console.log(`Mental health flag ${flagId} updated to ${newStatus}`);
        return { success: true };
    }
    return { success: false, error: 'Flag not found or no changes made' };
}

/**
 * Get mental health flag statistics for a course
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @returns {Promise<Object>}
 */
async function getMentalHealthFlagStats(db, courseId) {
    const collection = getCollection(db);

    // Counted with one query per status rather than a $group: this collection is
    // field-level encrypted, and the encryption wrapper only allows aggregation
    // stages it can prove safe over encrypted paths ($match/$sort/$skip/$limit/
    // $project). $status is plaintext, but the analyzer rejects the stage, not
    // the field. The status set is fixed and small, so the cost is bounded.
    const counts = await Promise.all(
        FLAG_STATUSES.map(status => collection.countDocuments({ courseId, status }))
    );

    const statistics = {
        total: 0,
        pending: 0,
        escalated: 0,
        dismissed: 0,
        resolved: 0,
        disregarded: 0
    };

    FLAG_STATUSES.forEach((status, index) => {
        statistics[status] = counts[index];
        statistics.total += counts[index];
    });

    return statistics;
}

module.exports = {
    createMentalHealthFlag,
    getMentalHealthFlagsForCourse,
    updateFlagStatus,
    getMentalHealthFlagStats
};
