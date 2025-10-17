/**
 * User Model for MongoDB
 * Stores user authentication and profile information
 * Supports both basic authentication and future SAML integration
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

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
        isActive: true,
        lastLogin: null,
        createdAt: now,
        updatedAt: now,
        preferences: {
            theme: 'light',
            notifications: true,
            courseId: userData.courseId || null
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
            preferences: user.preferences
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
        preferences: user.preferences,
        lastLogin: user.lastLogin
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
 * Create or get user for SAML authentication (future implementation)
 * @param {Object} db - MongoDB database instance
 * @param {Object} samlData - SAML authentication data
 * @returns {Promise<Object>} User result
 */
async function createOrGetSAMLUser(db, samlData) {
    const collection = getUsersCollection(db);
    
    // Check if user already exists with this SAML ID
    const existingUser = await collection.findOne({
        samlId: samlData.samlId,
        authProvider: 'saml'
    });
    
    if (existingUser) {
        // Update last login
        const now = new Date();
        await collection.updateOne(
            { userId: existingUser.userId },
            { $set: { lastLogin: now, updatedAt: now } }
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
        samlId: samlData.samlId,
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
    
    console.log(`SAML user created: ${userId} (${user.role})`);
    
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
    updateUserPreferences,
    createOrGetSAMLUser,
    getUsersByRole,
    deactivateUser
};
