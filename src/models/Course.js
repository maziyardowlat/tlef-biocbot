/**
 * Course Model for MongoDB
 * Stores course information and lecture publish status
 */

const { MongoClient } = require('mongodb');

/**
 * Course Schema Structure:
 * {
 *   _id: ObjectId,
 *   courseId: String,           // Unique course identifier
 *   courseName: String,         // Display name of the course
 *   instructorId: String,       // ID of the instructor
 *   lectures: [                 // Array of lectures/units
 *     {
 *       name: String,           // e.g., "Unit 1", "Week 1"
 *       isPublished: Boolean,   // Publish status
 *       createdAt: Date,        // When the lecture was created
 *       updatedAt: Date,        // Last update timestamp
 *       documents: [            // Array of uploaded documents
 *         {
 *           filename: String,
 *           originalName: String,
 *           size: Number,
 *           mimeType: String,
 *           uploadDate: Date,
 *           status: String      // "parsed", "needs-verify", "error"
 *         }
 *       ]
 *     }
 *   ],
 *   createdAt: Date,            // Course creation timestamp
 *   updatedAt: Date             // Last course update timestamp
 * }
 */

/**
 * Get the courses collection from the database
 * @param {Object} db - MongoDB database instance
 * @returns {Collection} Courses collection
 */
function getCoursesCollection(db) {
    return db.collection('courses');
}

/**
 * Create or update a course with lecture publish status
 * @param {Object} db - MongoDB database instance
 * @param {Object} courseData - Course data object
 * @returns {Promise<Object>} Created/updated course
 */
async function upsertCourse(db, courseData) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    const course = {
        ...courseData,
        updatedAt: now
    };
    
    if (!course.createdAt) {
        course.createdAt = now;
    }
    
    const result = await collection.updateOne(
        { courseId: courseData.courseId },
        { $set: course },
        { upsert: true }
    );
    
    return result;
}

/**
 * Update the publish status of a specific lecture
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} lectureName - Name of the lecture/unit
 * @param {boolean} isPublished - New publish status
 * @param {string} instructorId - ID of the instructor making the change
 * @returns {Promise<Object>} Update result
 */
async function updateLecturePublishStatus(db, courseId, lectureName, isPublished, instructorId) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    
    // First, ensure the course exists
    const course = await collection.findOne({ courseId });
    if (!course) {
        console.error(`Course ${courseId} not found for publish status update`);
        return { success: false, error: 'Course not found' };
    }
    
    // Check if the lecture already exists
    const existingLecture = course.lectures ? course.lectures.find(l => l.name === lectureName) : null;
    
    if (existingLecture) {
        // Update existing lecture with publish status
        const result = await collection.updateOne(
            { 
                courseId,
                'lectures.name': lectureName 
            },
            {
                $set: {
                    'lectures.$.isPublished': isPublished,
                    'lectures.$.updatedAt': now,
                    updatedAt: now,
                    instructorId
                }
            }
        );
        
        console.log(`Updated existing lecture ${lectureName} publish status to ${isPublished}`);
        return { success: true, created: false, modifiedCount: result.modifiedCount };
    } else {
        console.error(`Lecture ${lectureName} not found in course ${courseId}`);
        return { success: false, error: 'Lecture not found' };
    }
}

/**
 * Get the publish status of all lectures for a course
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @returns {Promise<Object>} Publish status for each lecture
 */
async function getLecturePublishStatus(db, courseId) {
    const collection = getCoursesCollection(db);
    
    const course = await collection.findOne(
        { courseId },
        { projection: { lectures: 1 } }
    );
    
    if (!course || !course.lectures) {
        return {};
    }
    
    // Convert to a simple object mapping lecture names to publish status
    const publishStatus = {};
    course.lectures.forEach(lecture => {
        publishStatus[lecture.name] = lecture.isPublished;
    });
    
    return publishStatus;
}

/**
 * Get all published lectures for student access
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @returns {Promise<Array>} Array of published lecture names
 */
async function getPublishedLectures(db, courseId) {
    const collection = getCoursesCollection(db);
    
    const course = await collection.findOne(
        { courseId },
        { projection: { lectures: 1 } }
    );
    
    if (!course || !course.lectures) {
        return [];
    }
    
    return course.lectures
        .filter(lecture => lecture.isPublished)
        .map(lecture => lecture.name);
}

/**
 * Update learning objectives for a specific lecture
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} lectureName - Name of the lecture/unit
 * @param {Array} objectives - Array of learning objectives
 * @param {string} instructorId - ID of the instructor making the change
 * @returns {Promise<Object>} Update result
 */
async function updateLearningObjectives(db, courseId, lectureName, objectives, instructorId) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    
    // First, ensure the course exists
    const course = await collection.findOne({ courseId });
    if (!course) {
        console.error(`Course ${courseId} not found for learning objectives update`);
        return { success: false, error: 'Course not found' };
    }
    
    // Check if the lecture already exists
    const existingLecture = course.lectures ? course.lectures.find(l => l.name === lectureName) : null;
    
    if (existingLecture) {
        // Update existing lecture with learning objectives
        const result = await collection.updateOne(
            { 
                courseId,
                'lectures.name': lectureName 
            },
            {
                $set: {
                    'lectures.$.learningObjectives': objectives,
                    'lectures.$.updatedAt': now,
                    updatedAt: now,
                    instructorId
                }
            }
        );
        
        console.log(`Updated existing lecture ${lectureName} with learning objectives`);
        return { success: true, created: false, modifiedCount: result.modifiedCount };
    } else {
        console.error(`Lecture ${lectureName} not found in course ${courseId}`);
        return { success: false, error: 'Lecture not found' };
    }
}

/**
 * Update pass threshold for a specific lecture
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} lectureName - Name of the lecture/unit
 * @param {number} passThreshold - Number of questions required to pass
 * @param {string} instructorId - ID of the instructor making the change
 * @returns {Promise<Object>} Update result
 */
async function updatePassThreshold(db, courseId, lectureName, passThreshold, instructorId) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    
    // First, ensure the course exists
    const course = await collection.findOne({ courseId });
    if (!course) {
        console.error(`Course ${courseId} not found for pass threshold update`);
        return { success: false, error: 'Course not found' };
    }
    
    // Check if the lecture already exists
    const existingLecture = course.lectures ? course.lectures.find(l => l.name === lectureName) : null;
    
    if (existingLecture) {
        // Update existing lecture with pass threshold
        const result = await collection.updateOne(
            { 
                courseId,
                'lectures.name': lectureName 
            },
            {
                $set: {
                    'lectures.$.passThreshold': passThreshold,
                    'lectures.$.updatedAt': now,
                    updatedAt: now,
                    instructorId
                }
            }
        );
        
        console.log(`Updated existing lecture ${lectureName} with pass threshold ${passThreshold}`);
        return { success: true, created: false, modifiedCount: result.modifiedCount };
    } else {
        console.error(`Lecture ${lectureName} not found in course ${courseId}`);
        return { success: false, error: 'Lecture not found' };
    }
}

/**
 * Get pass threshold for a specific lecture
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} lectureName - Name of the lecture/unit
 * @returns {Promise<number>} Pass threshold value
 */
async function getPassThreshold(db, courseId, lectureName) {
    const collection = getCoursesCollection(db);
    
    const course = await collection.findOne(
        { courseId },
        { projection: { lectures: 1 } }
    );
    
    if (!course || !course.lectures) {
        return 2; // Default threshold
    }
    
    // Find the specific lecture and return its pass threshold
    const lecture = course.lectures.find(l => l.name === lectureName);
    return lecture ? (lecture.passThreshold || 2) : 2;
}



/**
 * Get learning objectives for a specific lecture
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} lectureName - Name of the lecture/unit
 * @returns {Promise<Array>} Array of learning objectives
 */
async function getLearningObjectives(db, courseId, lectureName) {
    const collection = getCoursesCollection(db);
    
    const course = await collection.findOne(
        { courseId },
        { projection: { lectures: 1 } }
    );
    
    if (!course || !course.lectures) {
        return [];
    }
    
    // Find the specific lecture and return its learning objectives
    const lecture = course.lectures.find(l => l.name === lectureName);
    return lecture ? (lecture.learningObjectives || []) : [];
}

/**
 * Create or update a course with onboarding data and generate units
 * @param {Object} db - MongoDB database instance
 * @param {Object} onboardingData - Onboarding data including course structure
 * @returns {Promise<Object>} Created/updated course with units
 */
async function createCourseFromOnboarding(db, onboardingData) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    const {
        courseId,
        courseName,
        instructorId,
        courseDescription,
        learningOutcomes,
        prerequisites,
        assessmentCriteria,
        courseMaterials,
        courseStructure
    } = onboardingData;
    
    try {
        // Check if course already exists for this instructor
        const existingCourse = await collection.findOne({ 
            $or: [
                { courseId: onboardingData.courseId },
                { instructorId: onboardingData.instructorId }
            ]
        });
        
        if (existingCourse) {
            console.log(`Course already exists for instructor ${instructorId}: ${existingCourse.courseId}`);
            return {
                success: true,
                created: false,
                modifiedCount: 0,
                courseId: existingCourse.courseId,
                totalUnits: existingCourse.courseStructure?.totalUnits || 0,
                message: 'Course already exists'
            };
        }
        
        // Calculate total units from weeks and lectures per week
        const totalUnits = courseStructure.weeks * courseStructure.lecturesPerWeek;
        
        // Generate units array
        const units = [];
        for (let i = 1; i <= totalUnits; i++) {
            const unitName = `Unit ${i}`;
            
            // Check if we have existing data for this unit from onboarding
            let existingUnitData = {};
            if (onboardingData.unitFiles && onboardingData.unitFiles[unitName]) {
                existingUnitData = onboardingData.unitFiles[unitName];
            }
            
            // For Unit 1, use learning outcomes from onboarding if available
            let learningObjectives = [];
            if (i === 1 && learningOutcomes && learningOutcomes.length > 0) {
                learningObjectives = learningOutcomes;
                console.log(`Setting Unit 1 learning objectives:`, learningObjectives);
            }
            
            // Debug: Log what we're setting for each unit
            console.log(`Unit ${i} (${unitName}): learningObjectives =`, learningObjectives);
            
            units.push({
                name: unitName,
                isPublished: false,
                learningObjectives: learningObjectives, // This should now work correctly
                passThreshold: 2, // Default threshold
                createdAt: now,
                updatedAt: now,
                documents: [],
                unitFiles: {
                    lectureNotes: existingUnitData.lectureNotes || [],
                    practiceQuestions: existingUnitData.practiceQuestions || [],
                    additionalMaterials: existingUnitData.additionalMaterials || []
                }
            });
        }
        
        // Prepare the course document
        const course = {
            courseId,
            courseName,
            instructorId,
            courseDescription: courseDescription || '',
            prerequisites: prerequisites || [],
            assessmentCriteria: assessmentCriteria || '',
            courseMaterials: courseMaterials || [],
            courseStructure: {
                weeks: courseStructure.weeks,
                lecturesPerWeek: courseStructure.lecturesPerWeek,
                totalUnits: totalUnits
            },
            isOnboardingComplete: true, // Flag to track onboarding completion
            lectures: units, // Use the existing lectures field for units
            createdAt: now,
            updatedAt: now
        };
        
        console.log(`Creating course from onboarding: ${courseId} with ${totalUnits} units`);
        
        const result = await collection.insertOne(course);
        
        console.log(`Course created with ${totalUnits} units`);
        
        return {
            success: true,
            created: true,
            modifiedCount: 1,
            courseId,
            totalUnits
        };
    } catch (error) {
        console.error('Error creating course from onboarding:', error);
        throw error;
    }
}

/**
 * Get course with onboarding data
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @returns {Promise<Object|null>} Course data or null if not found
 */
async function getCourseWithOnboarding(db, courseId) {
    const collection = getCoursesCollection(db);
    
    try {
        const course = await collection.findOne({ courseId });
        return course;
    } catch (error) {
        console.error('Error fetching course with onboarding data:', error);
        throw error;
    }
}

/**
 * Update onboarding completion status
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {boolean} isComplete - Whether onboarding is complete
 * @returns {Promise<Object>} Update result
 */
async function updateOnboardingStatus(db, courseId, isComplete) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    
    try {
        const result = await collection.updateOne(
            { courseId },
            {
                $set: {
                    isOnboardingComplete: isComplete,
                    updatedAt: now
                }
            }
        );
        
        return {
            success: true,
            modifiedCount: result.modifiedCount,
            courseId
        };
    } catch (error) {
        console.error('Error updating onboarding status:', error);
        throw error;
    }
}

/**
 * Delete a unit from a course
 * @param {Object} db - MongoDB database instance
 * @param {string} courseId - Course identifier
 * @param {string} unitName - Name of the unit to delete
 * @returns {Promise<Object>} Deletion result
 */
async function deleteUnit(db, courseId, unitName) {
    const collection = getCoursesCollection(db);
    
    const now = new Date();
    
    try {
        const result = await collection.updateOne(
            { courseId },
            {
                $pull: { lectures: { name: unitName } },
                $set: { updatedAt: now }
            }
        );
        
        return {
            success: true,
            deletedCount: result.modifiedCount,
            courseId,
            unitName
        };
    } catch (error) {
        console.error('Error deleting unit:', error);
        throw error;
    }
}

module.exports = {
    getCoursesCollection,
    upsertCourse,
    updateLecturePublishStatus,
    getLecturePublishStatus,
    getPublishedLectures,
    updateLearningObjectives,
    getLearningObjectives,
    updatePassThreshold,
    getPassThreshold,
    createCourseFromOnboarding,
    getCourseWithOnboarding,
    updateOnboardingStatus,
    deleteUnit
};
