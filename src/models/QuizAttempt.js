/**
 * QuizAttempt Model
 * Tracks individual quiz practice attempts by students
 */

const { createId } = require('../services/id');
const COLLECTION_NAME = 'quizAttempts';

function getCollection(db) {
    return db.collection(COLLECTION_NAME);
}

/**
 * Generate a unique attempt ID
 * @returns {string} Prefixed collision-resistant attempt ID
 */
function generateAttemptId() {
    return createId('qa');
}

/**
 * Save a quiz attempt
 * @param {Object} db - MongoDB database instance
 * @param {Object} attemptData - Attempt data
 * @returns {Promise<Object>} Insert result
 */
async function saveAttempt(db, attemptData) {
    const collection = getCollection(db);

    const attempt = {
        attemptId: generateAttemptId(),
        studentId: attemptData.studentId,
        courseId: attemptData.courseId,
        questionId: attemptData.questionId,
        lectureName: attemptData.lectureName,
        questionType: attemptData.questionType,
        studentAnswer: attemptData.studentAnswer,
        correct: attemptData.correct,
        feedback: attemptData.feedback || '',
        attemptedAt: new Date()
    };

    await collection.insertOne(attempt);

    return {
        success: true,
        attemptId: attempt.attemptId
    };
}

/**
 * Get all attempts for a student in a course
 * @param {Object} db - MongoDB database instance
 * @param {string} studentId - Student user ID
 * @param {string} courseId - Course ID
 * @returns {Promise<Array>} Array of attempt records
 */
async function getAttemptsByStudent(db, studentId, courseId) {
    const collection = getCollection(db);

    return collection.find({
        studentId,
        courseId
    }).sort({ attemptedAt: -1 }).toArray();
}

/**
 * Get aggregated stats for a student in a course
 * @param {Object} db - MongoDB database instance
 * @param {string} studentId - Student user ID
 * @param {string} courseId - Course ID
 * @returns {Promise<Object>} Stats object
 */
async function getAttemptStats(db, studentId, courseId) {
    const collection = getCollection(db);

    // Counted here rather than with $group: the encryption wrapper rejects
    // $group on protected collections, and one student's attempts are few.
    const attempts = await collection.find(
        { studentId, courseId },
        { projection: { lectureName: 1, correct: 1 } }
    ).toArray();

    let correctCount = 0;
    const unitBreakdown = {};
    for (const entry of attempts) {
        if (!unitBreakdown[entry.lectureName]) {
            unitBreakdown[entry.lectureName] = { total: 0, correct: 0 };
        }
        unitBreakdown[entry.lectureName].total++;
        if (entry.correct) {
            correctCount++;
            unitBreakdown[entry.lectureName].correct++;
        }
    }

    const totalAttempts = attempts.length;
    return {
        totalAttempts,
        correctCount,
        accuracy: totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0,
        unitBreakdown
    };
}

module.exports = {
    saveAttempt,
    getAttemptsByStudent,
    getAttemptStats
};
