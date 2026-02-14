/**
 * User Model for MongoDB
 * Stores user authentication and profile information
 * Supports both basic authentication and future SAML integration
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const StruggleActivity = require('./StruggleActivity');

/**
 * User Schema Structure:
 * {
 *   _id: ObjectId,
 *   userId: String,              // Unique user identifier
 *   username: String,            // Username for basic auth
 *   email: String,               // User email address
 *   passwordHash: String,        // Hashed password (for basic auth)
 *   role: String,                // "instructor", "student", or "ta"
 *   displayName: String,         // Display name for UI
 *   authProvider: String,        // "basic" or "saml" (for future)
 *   samlId: String,              // SAML identifier (for future)
 *   puid: String,                // UBC Personal Unique Identifier (for CWL authentication)
 *   isActive: Boolean,           // Account status
 *   lastLogin: Date,             // Last login timestamp
 *   createdAt: Date,             // Account creation timestamp
 *   updatedAt: Date,             // Last update timestamp
 *   preferences: {               // User preferences
 *     theme: String,             // UI theme preference
 *     notifications: Boolean,    // Notification preferences
 *     courseId: String           // Current course context
 *   }
 * }
 */

/**
 * Get the users collection from the database
 * @param {Object} db - MongoDB database instance
 * @returns {Collection} Users collection
 */
function getUsersCollection(db) {
    return db.collection('users');
}

/**
 * Create a new user account
 * @param {Object} db - MongoDB database instance
 * @param {Object} userData - User data object
 * @returns {Promise<Object>} Created user result
 */
async function createUser(db, userData) {
    const collection = getUsersCollection(db);
    
    const now = new Date();
    
    // Generate unique user ID
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Hash password if provided (for basic auth)
    let passwordHash = null;
    if (userData.password) {
        const saltRounds = 12;
        passwordHash = await bcrypt.hash(userData.password, saltRounds);
    }
    
    const user = {
        userId,
        username: userData.username,
        email: userData.email && userData.email.trim() !== '' ? userData.email : null,
        passwordHash,
        role: userData.role, // "instructor", "student", or "ta"
        displayName: userData.displayName && userData.displayName.trim() !== '' ? userData.displayName : userData.username,
        authProvider: userData.authProvider || 'basic',
        samlId: userData.samlId || null,
        puid: userData.puid || null, // UBC Personal Unique Identifier (for CWL authentication)
        isActive: true,
        lastLogin: null,
        createdAt: now,
        updatedAt: now,
        preferences: {
            theme: 'light',
            notifications: true,
            courseId: userData.courseId || null
        },
        struggleState: {
            topics: [] // Array of { topic: String, count: Number, lastStruggle: Date, isActive: Boolean }
        }
    };
    
    // Check if user already exists
    const queryConditions = [{ username: userData.username }];
    
    // Only check email if it's provided and not empty
    if (userData.email && userData.email.trim() !== '') {
        queryConditions.push({ email: userData.email });
    }
    
    const existingUser = await collection.findOne({
        $or: queryConditions
    });
    
    if (existingUser) {
        let errorMessage = 'User already exists with this username';
        if (userData.email && userData.email.trim() !== '' && existingUser.email === userData.email) {
            errorMessage = 'User already exists with this email address';
        } else if (existingUser.username === userData.username) {
            errorMessage = 'User already exists with this username';
        }
        
        return {
            success: false,
            error: errorMessage
        };
    }
    
    const result = await collection.insertOne(user);
    
    console.log(`User created: ${userId} (${userData.role})`);
    
    return {
        success: true,
        userId,
        insertedId: result.insertedId,
        user: {
            userId,
            username: user.username,
            email: user.email,
            role: user.role,
            displayName: user.displayName,
            authProvider: user.authProvider
        }
    };
}

/**
 * Authenticate user with username and password
 * @param {Object} db - MongoDB database instance
 * @param {string} username - Username or email
 * @param {string} password - Plain text password
 * @returns {Promise<Object>} Authentication result
 */
async function authenticateUser(db, username, password) {
    const collection = getUsersCollection(db);
    
    // Find user by username or email
    const user = await collection.findOne({
        $or: [
            { username: username },
            { email: username }
        ],
        isActive: true
    });
    
    if (!user) {
        return {
            success: false,
            error: 'Invalid username or password'
        };
    }
    
    // Check password for basic auth
    if (user.authProvider === 'basic' && user.passwordHash) {
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return {
                success: false,
                error: 'Invalid username or password'
            };
        }
    }
    
    // Update last login
    const now = new Date();
    await collection.updateOne(
        { userId: user.userId },
        { $set: { lastLogin: now, updatedAt: now } }
    );
    
    console.log(`User authenticated: ${user.userId} (${user.role})`);
    
    return {
        success: true,
        user: {
            userId: user.userId,
            username: user.username,
            email: user.email,
            role: user.role,
            displayName: user.displayName,
            authProvider: user.authProvider,
            preferences: user.preferences,
            invitedCourses: user.invitedCourses || []
        }
    };
}

/**
 * Get user by ID
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User identifier
 * @returns {Promise<Object>} User object or null
 */
async function getUserById(db, userId) {
    const collection = getUsersCollection(db);
    
    const user = await collection.findOne({ 
        userId,
        isActive: true 
    });
    
    if (!user) {
        return null;
    }
    
    return {
        userId: user.userId,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        authProvider: user.authProvider,
        authProvider: user.authProvider,
        preferences: user.preferences,
        lastLogin: user.lastLogin,
        struggleState: user.struggleState,
        invitedCourses: user.invitedCourses || []
    };
}

/**
 * Get user by PUID (UBC Personal Unique Identifier)
 * Used for CWL authentication to find existing users
 * @param {Object} db - MongoDB database instance
 * @param {string} puid - UBC Personal Unique Identifier
 * @returns {Promise<Object>} User object or null
 */
async function getUserByPuid(db, puid) {
    const collection = getUsersCollection(db);
    
    if (!puid) {
        return null;
    }
    
    const user = await collection.findOne({ 
        puid,
        isActive: true 
    });
    
    if (!user) {
        return null;
    }
    
    return {
        userId: user.userId,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        authProvider: user.authProvider,
        preferences: user.preferences,
        lastLogin: user.lastLogin,
        puid: user.puid
    };
}

/**
 * Update user preferences
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User identifier
 * @param {Object} preferences - New preferences
 * @returns {Promise<Object>} Update result
 */
async function updateUserPreferences(db, userId, preferences) {
    const collection = getUsersCollection(db);
    
    const now = new Date();
    
    const result = await collection.updateOne(
        { userId },
        {
            $set: {
                'preferences': preferences,
                updatedAt: now
            }
        }
    );
    
    if (result.modifiedCount > 0) {
        console.log(`User preferences updated: ${userId}`);
        return { success: true, modifiedCount: result.modifiedCount };
    } else {
        return { success: false, error: 'User not found or no changes made' };
    }
}

/**
 * Create or get user for SAML authentication
 * For CWL (UBC Shibboleth) users, PUID is the primary identifier
 * @param {Object} db - MongoDB database instance
 * @param {Object} samlData - SAML authentication data
 * @param {string} samlData.samlId - SAML identifier (nameID or fallback)
 * @param {string} samlData.puid - UBC Personal Unique Identifier (for CWL users)
 * @param {string} samlData.email - User email address
 * @param {string} samlData.username - Username
 * @param {string} samlData.displayName - Display name
 * @param {string} samlData.role - User role
 * @returns {Promise<Object>} User result
 */
async function createOrGetSAMLUser(db, samlData) {
    const collection = getUsersCollection(db);
    
    // For CWL users, PUID is the primary identifier for user lookup
    // Check if user already exists by PUID first (most reliable for CWL)
    // Then fall back to samlId if PUID is not available
    const queryConditions = [];
    
    if (samlData.puid) {
        // PUID is the primary identifier for CWL users
        queryConditions.push({ puid: samlData.puid, authProvider: 'saml' });
    }
    
    // Also check by samlId as fallback (for non-CWL SAML users)
    if (samlData.samlId) {
        queryConditions.push({ samlId: samlData.samlId, authProvider: 'saml' });
    }
    
    // If no query conditions, we can't look up existing users
    if (queryConditions.length === 0) {
        return {
            success: false,
            error: 'SAML data missing required identifier (puid or samlId)'
        };
    }
    
    // Find existing user by PUID or samlId
    const existingUser = await collection.findOne({
        $or: queryConditions
    });
    
    if (existingUser) {
        // User exists - update PUID if it wasn't stored before (migration case)
        const updateFields = {
            lastLogin: new Date(),
            updatedAt: new Date()
        };
        
        // If PUID is provided but not stored, add it
        if (samlData.puid && !existingUser.puid) {
            updateFields.puid = samlData.puid;
            console.log(`Updating existing user ${existingUser.userId} with PUID: ${samlData.puid}`);
        }
        
        // Update last login and PUID if needed
        await collection.updateOne(
            { userId: existingUser.userId },
            { $set: updateFields }
        );
        
        return {
            success: true,
            user: {
                userId: existingUser.userId,
                username: existingUser.username,
                email: existingUser.email,
                role: existingUser.role,
                displayName: existingUser.displayName,
                authProvider: existingUser.authProvider,
                preferences: existingUser.preferences
            }
        };
    }
    
    // Create new SAML user
    const now = new Date();
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const user = {
        userId,
        username: samlData.username || samlData.email,
        email: samlData.email,
        passwordHash: null, // No password for SAML users
        role: samlData.role || 'student', // Default to student, can be updated
        displayName: samlData.displayName || samlData.username,
        authProvider: 'saml',
        samlId: samlData.samlId || null,
        puid: samlData.puid || null, // Store PUID for CWL users
        isActive: true,
        lastLogin: now,
        createdAt: now,
        updatedAt: now,
        preferences: {
            theme: 'light',
            notifications: true,
            courseId: null
        }
    };
    
    const result = await collection.insertOne(user);
    
    console.log(`SAML user created: ${userId} (${user.role})${samlData.puid ? ` with PUID: ${samlData.puid}` : ''}`);
    
    return {
        success: true,
        userId,
        insertedId: result.insertedId,
        user: {
            userId,
            username: user.username,
            email: user.email,
            role: user.role,
            displayName: user.displayName,
            authProvider: user.authProvider,
            preferences: user.preferences
        }
    };
}

/**
 * Get all users by role
 * @param {Object} db - MongoDB database instance
 * @param {string} role - User role to filter by
 * @returns {Promise<Array>} Array of users
 */
async function getUsersByRole(db, role) {
    const collection = getUsersCollection(db);
    
    const users = await collection.find({ 
        role,
        isActive: true 
    })
    .project({
        userId: 1,
        username: 1,
        email: 1,
        displayName: 1,
        lastLogin: 1,
        createdAt: 1
    })
    .sort({ createdAt: -1 })
    .toArray();
    
    return users;
}

/**
 * Deactivate user account
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User identifier
 * @returns {Promise<Object>} Deactivation result
 */
async function deactivateUser(db, userId) {
    const collection = getUsersCollection(db);
    
    const now = new Date();
    
    const result = await collection.updateOne(
        { userId },
        {
            $set: {
                isActive: false,
                updatedAt: now
            }
        }
    );
    
    if (result.modifiedCount > 0) {
        console.log(`User deactivated: ${userId}`);
        return { success: true, modifiedCount: result.modifiedCount };
    } else {
        return { success: false, error: 'User not found' };
    }
}

module.exports = {
    getUsersCollection,
    createUser,
    authenticateUser,
    getUserById,
    getUserByPuid,
    updateUserPreferences,
    createOrGetSAMLUser,
    getUsersByRole,
    deactivateUser,
    updateUserStruggleState,
    resetUserStruggleState
};

/**
 * Update user struggle state for a detected topic
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User identifier
 * @param {Object} struggleData - Analysis result { topic, isStruggling }
 * @param {Object} socketManager - Optional Socket.IO manager for emitting real-time events
 * @param {string} courseId - Course ID context (from current chat/session)
 * @returns {Promise<Object>} Update result and current state
 */
async function updateUserStruggleState(db, userId, struggleData, socketManager = null, courseId = null) {
    const collection = getUsersCollection(db);
    const { topic, isStruggling } = struggleData;
    const now = new Date();
    
    // Normalize topic for consistency (simple lowercase for now)
    const normalizedTopic = topic.toLowerCase().trim();

    // 1. Get current user to find existing topic state
    const user = await collection.findOne({ userId });
    if (!user) return { success: false, error: 'User not found' };

    let topics = user.struggleState?.topics || [];
    let currentTopicIndex = topics.findIndex(t => t.topic === normalizedTopic);
    let topicState = null;

    if (currentTopicIndex === -1) {
        // New topic
        topicState = {
            topic: normalizedTopic,
            count: isStruggling ? 1 : 0,
            lastStruggle: isStruggling ? now : null,
            isActive: false // Directive mode triggers at count >= 3
        };
        topics.push(topicState);
    } else {
        // Existing topic
        topicState = topics[currentTopicIndex];
        
        if (isStruggling) {
            topicState.count += 1;
            topicState.lastStruggle = now;
        } else {
            // Optional: Decay logic or reset on good understanding? 
            // For now, we only increment on struggle. 
            // The prompt "reset" button handles clearing.
        }
        
        // Update in array
        topics[currentTopicIndex] = topicState;
    }

    // Track if this is a NEW activation (was not active before, now is active)
    const wasActive = currentTopicIndex !== -1 ? topics[currentTopicIndex].isActive : false;
    
    // Check if Directive Mode should be active
    topicState.isActive = topicState.count >= 3;
    
    // Emit Socket.IO event if this is a NEW activation (transition from inactive to active)
    const isNewActivation = !wasActive && topicState.isActive;
    if (isNewActivation) {
        // Use passed courseId or fallback to user preferences
        const activeCourseId = courseId || user.preferences?.courseId || null;
        const studentName = user.displayName || user.username || 'Unknown Student';
        
        // Emit Socket.IO event for real-time updates
        if (socketManager) {
            socketManager.emitStruggleStateChange(activeCourseId, {
                userId: user.userId,
                studentName: studentName,
                topic: normalizedTopic,
                state: 'Active',
                timestamp: now,
                courseId: activeCourseId
            });
            
            console.log(`📊 [SOCKET] Emitted Active state change for ${studentName} - Topic: ${normalizedTopic}`);
        }
        
        // Persist to activity history for permanent record
        await StruggleActivity.createActivityEntry(db, {
            userId: user.userId,
            studentName: studentName,
            courseId: activeCourseId,
            topic: normalizedTopic,
            state: 'Active',
            timestamp: now
        });
    }

    // Persist changes
    await collection.updateOne(
        { userId },
        { 
            $set: { 
                'struggleState.topics': topics,
                updatedAt: now
            }
        }
    );

    return { 
        success: true, 
        state: topicState,
        allTopics: topics 
    };
}

/**
 * Reset struggle state for a topic
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User identifier
 * @param {string} topic - Topic to reset (or 'ALL' for global reset)
 * @param {Object} socketManager - Optional Socket.IO manager for emitting real-time events
 * @param {string} courseId - Course ID context (from current session)
 * @returns {Promise<Object>} Update result
 */
async function resetUserStruggleState(db, userId, topic, socketManager = null, courseId = null) {
    const collection = getUsersCollection(db);
    const now = new Date();
    
    // Get user first to fetch info for Socket.IO event
    const user = await collection.findOne({ userId });
    if (!user) return { success: false, error: 'User not found' };
    
    const studentName = user.displayName || user.username || 'Unknown Student';
    // Use passed courseId or fallback to user preferences
    const activeCourseId = courseId || user.preferences?.courseId || null;

    let updateOp = {};
    let topicsToReset = []; // Track which topics were reset
    
    if (topic === 'ALL') {
        // Get all topics before clearing
        topicsToReset = user.struggleState?.topics || [];
        
        updateOp.$set = { 
            'struggleState.topics': [],
            updatedAt: now
        };
    } else {
        // Find the specific topic
        const normalizedTopic = topic.toLowerCase().trim();
        const existingTopic = user.struggleState?.topics?.find(t => t.topic === normalizedTopic);
        
        if (existingTopic) {
            topicsToReset = [existingTopic];
        }
        
        // Remove specific topic
        updateOp.$pull = { 'struggleState.topics': { topic: normalizedTopic } };
        updateOp.$set = { updatedAt: now };
    }

    const result = await collection.updateOne(
        { userId },
        updateOp
    );
    
    // Emit Socket.IO events and persist to history for each topic that was reset (deactivated)
    if (topicsToReset.length > 0) {
        for (const topicObj of topicsToReset) {
            // Emit Socket.IO event for real-time updates
            if (socketManager) {
                socketManager.emitStruggleStateChange(activeCourseId, {
                    userId: user.userId,
                    studentName: studentName,
                    topic: topicObj.topic,
                    state: 'Inactive',
                    timestamp: now,
                    courseId: activeCourseId
                });
                
                console.log(`📊 [SOCKET] Emitted Inactive state change for ${studentName} - Topic: ${topicObj.topic}`);
            }
            
            // Persist to activity history for permanent record
            await StruggleActivity.createActivityEntry(db, {
                userId: user.userId,
                studentName: studentName,
                courseId: activeCourseId,
                topic: topicObj.topic,
                state: 'Inactive',
                timestamp: now
            });
        }
    }

    return { success: true };
}
