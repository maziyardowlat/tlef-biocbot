/**
 * TopicDashboardTime Model
 *
 * Tracks cumulative time each student spends on the student-facing Topic
 * Dashboard page, per course. The dashboard page's own timer pauses while
 * the tab/window is hidden or unfocused and only reports genuinely active
 * elapsed ms, so this model just accumulates those increments into one
 * running total per student+course for instructors to see in Student Hub.
 */

const COLLECTION_NAME = 'topicDashboardTime';

// Guard against a single increment skewing totals if a client sends a
// stale/corrupted value (e.g. a suspended laptop waking up mid-session).
const MAX_SINGLE_INCREMENT_MS = 60 * 60 * 1000; // 1 hour

function getCollection(db) {
    return db.collection(COLLECTION_NAME);
}

async function ensureIndexes(db) {
    const collection = getCollection(db);
    await collection.createIndex(
        { courseId: 1, userId: 1 },
        { unique: true, name: 'unique_topic_dashboard_time_per_student_course' }
    );
}

/**
 * Add an increment of active time for a student on a course's Topic Dashboard.
 * @param {Object} db
 * @param {Object} data
 * @param {string} data.userId
 * @param {string} data.courseId
 * @param {number} data.durationMs - elapsed active ms to add
 * @returns {Promise<Object|null>} the updated document, or null if durationMs was invalid
 */
async function addVisitDuration(db, { userId, courseId, durationMs }) {
    const parsed = Number(durationMs);
    if (!userId || !courseId || !Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    const clamped = Math.min(parsed, MAX_SINGLE_INCREMENT_MS);
    const collection = getCollection(db);
    const now = new Date();

    return collection.findOneAndUpdate(
        { userId, courseId },
        {
            $inc: { totalMs: clamped },
            $set: { updatedAt: now },
            $setOnInsert: { userId, courseId, createdAt: now }
        },
        { upsert: true, returnDocument: 'after' }
    );
}

/**
 * Get the cumulative Topic Dashboard time for every student in a course.
 * @returns {Promise<Object>} map of userId -> totalMs
 */
async function getTotalsForCourse(db, courseId) {
    const collection = getCollection(db);
    const rows = await collection.find({ courseId }).project({ userId: 1, totalMs: 1 }).toArray();
    const totals = {};
    rows.forEach(row => {
        totals[row.userId] = row.totalMs || 0;
    });
    return totals;
}

module.exports = {
    COLLECTION_NAME,
    ensureIndexes,
    addVisitDuration,
    getTotalsForCourse
};
