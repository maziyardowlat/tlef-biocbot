/**
 * Passport Configuration
 * Configures authentication strategies for BiocBot
 * Supports: Local (username/password), SAML, and UBC Shibboleth
 */

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const SamlStrategy = require('passport-saml').Strategy;
const User = require('../models/User');

// Try to import passport-ubcshib (may not be available in all environments)
let UBCShibStrategy;
try {
    const ubcshib = require('passport-ubcshib');
    UBCShibStrategy = ubcshib.Strategy;
} catch (error) {
    console.warn('⚠️ passport-ubcshib not available, UBC Shibboleth authentication will be disabled');
    UBCShibStrategy = null;
}

/**
 * Initialize Passport strategies
 * @param {Object} db - MongoDB database instance
 * @returns {Object} Configured passport instance
 */
function initializePassport(db) {
    /**
     * Local Strategy - Username/Password Authentication
     * Used for basic authentication (instructor, student, ta)
     */
    passport.use('local', new LocalStrategy(
        {
            usernameField: 'username', // Field name for username in request
            passwordField: 'password', // Field name for password in request
            passReqToCallback: false // Don't pass request to callback
        },
        async (username, password, done) => {
            try {
                // Authenticate user using existing User model
                const result = await User.authenticateUser(db, username, password);
                
                if (!result.success) {
                    // Authentication failed
                    return done(null, false, { message: result.error });
                }
                
                // Authentication successful - return user
                return done(null, result.user);
                
            } catch (error) {
                console.error('Error in local strategy:', error);
                return done(error);
            }
        }
    ));

    /**
     * SAML Strategy - Generic SAML 2.0 Authentication
     * Used for SAML-based authentication (can be configured for any SAML IdP)
     * Only configured if SAML environment variables are set
     */
    const samlEntryPoint = process.env.SAML_ENTRY_POINT;
    const samlIssuer = process.env.SAML_ISSUER;
    const samlCallbackUrl = process.env.SAML_CALLBACK_URL;
    const samlCert = process.env.SAML_CERT;
    const samlPrivateKey = process.env.SAML_PRIVATE_KEY;

    if (samlEntryPoint && samlIssuer && samlCallbackUrl && samlCert) {
        try {
            passport.use('saml', new SamlStrategy(
                {
                    entryPoint: samlEntryPoint,
                    issuer: samlIssuer,
                    callbackUrl: samlCallbackUrl,
                    cert: samlCert,
                    privateKey: samlPrivateKey || null,
                    signatureAlgorithm: process.env.SAML_SIGNATURE_ALGORITHM || 'sha256',
                    digestAlgorithm: process.env.SAML_DIGEST_ALGORITHM || 'sha256',
                    acceptedClockSkewMs: parseInt(process.env.SAML_CLOCK_SKEW_MS) || 0,
                    validateInResponseTo: process.env.SAML_VALIDATE_IN_RESPONSE_TO === 'true',
                    disableRequestAcsUrl: process.env.SAML_DISABLE_REQUEST_ACS_URL === 'true'
                },
                async (profile, done) => {
                    try {
                        // Extract SAML attributes
                        const samlId = profile.nameID || profile.ID || profile.issuer;
                        const email = profile.email || profile.mail || profile['urn:oid:0.9.2342.19200300.100.1.3'];
                        const displayName = profile.displayName || profile.cn || email;

                        if (!samlId || !email) {
                            return done(null, false, { message: 'SAML profile missing required attributes' });
                        }

                        // Create or get user from SAML data
                        const samlData = {
                            samlId: samlId,
                            email: email,
                            username: email.split('@')[0], // Use email prefix as username
                            displayName: displayName,
                            role: profile.role || 'student' // Default to student, can be mapped from SAML attributes
                        };

                        const result = await User.createOrGetSAMLUser(db, samlData);
                        
                        if (!result.success) {
                            return done(null, false, { message: result.error });
                        }

                        // Return user object
                        return done(null, result.user);

                    } catch (error) {
                        console.error('Error in SAML strategy:', error);
                        return done(error);
                    }
                }
            ));
            console.log('✅ SAML strategy configured');
        } catch (error) {
            console.error('❌ Failed to configure SAML strategy:', error.message);
        }
    } else {
        console.log('ℹ️ SAML strategy not configured (missing environment variables)');
    }

    /**
     * UBC Shibboleth Strategy - UBC-specific SAML Authentication
     * Uses passport-ubcshib for UBC's Shibboleth IdP integration
     * Only configured if UBC Shibboleth environment variables are set
     */
    if (UBCShibStrategy) {
        const ubcShibIssuer = process.env.UBC_SAML_ISSUER || process.env.SAML_ISSUER;
        const ubcShibCallbackUrl = process.env.UBC_SAML_CALLBACK_URL || process.env.SAML_CALLBACK_URL;
        const ubcShibPrivateKeyPath = process.env.UBC_SAML_PRIVATE_KEY_PATH || process.env.SAML_PRIVATE_KEY_PATH;
        const ubcShibEnvironment = process.env.SAML_ENVIRONMENT || process.env.UBC_SAML_ENVIRONMENT || 'STAGING';
        const ubcShibAttributeConfig = process.env.UBC_SAML_ATTRIBUTES 
            ? process.env.UBC_SAML_ATTRIBUTES.split(',').map(a => a.trim())
            : ['ubcEduCwlPuid', 'mail', 'eduPersonAffiliation'];

        if (ubcShibIssuer && ubcShibCallbackUrl) {
            try {
                passport.use('ubcshib', new UBCShibStrategy(
                    {
                        issuer: ubcShibIssuer,
                        callbackUrl: ubcShibCallbackUrl,
                        privateKeyPath: ubcShibPrivateKeyPath,
                        attributeConfig: ubcShibAttributeConfig,
                        enableSLO: process.env.UBC_SAML_ENABLE_SLO !== 'false',
                        validateInResponseTo: process.env.UBC_SAML_VALIDATE_IN_RESPONSE_TO !== 'false',
                        acceptedClockSkewMs: parseInt(process.env.UBC_SAML_CLOCK_SKEW_MS) || 0
                    },
                    async (profile, done) => {
                        try {
                            // Extract UBC Shibboleth attributes
                            const samlId = profile.nameID || profile.attributes?.ubcEduCwlPuid;
                            const email = profile.attributes?.mail || profile.attributes?.email || profile.nameID;
                            const displayName = profile.attributes?.displayName || profile.attributes?.cn || email;
                            const ubcPuid = profile.attributes?.ubcEduCwlPuid;
                            const affiliation = profile.attributes?.eduPersonAffiliation || [];

                            if (!samlId || !email) {
                                return done(null, false, { message: 'UBC Shibboleth profile missing required attributes' });
                            }

                            // Determine role from affiliation
                            // UBC affiliation can be: student, faculty, staff, member, etc.
                            let role = 'student'; // Default role
                            if (Array.isArray(affiliation)) {
                                if (affiliation.includes('faculty') || affiliation.includes('staff')) {
                                    role = 'instructor'; // Faculty/staff are instructors
                                } else if (affiliation.includes('student')) {
                                    role = 'student';
                                }
                            }

                            // Create or get user from UBC Shibboleth data
                            const samlData = {
                                samlId: samlId || ubcPuid,
                                email: email,
                                username: ubcPuid || email.split('@')[0],
                                displayName: displayName,
                                role: role
                            };

                            const result = await User.createOrGetSAMLUser(db, samlData);
                            
                            if (!result.success) {
                                return done(null, false, { message: result.error });
                            }

                            // Store UBC-specific attributes in user preferences
                            if (ubcPuid && result.user) {
                                // Could store additional UBC attributes here if needed
                                result.user.ubcPuid = ubcPuid;
                            }

                            // Return user object
                            return done(null, result.user);

                        } catch (error) {
                            console.error('Error in UBC Shibboleth strategy:', error);
                            return done(error);
                        }
                    }
                ));
                console.log(`✅ UBC Shibboleth strategy configured (${ubcShibEnvironment})`);
            } catch (error) {
                console.error('❌ Failed to configure UBC Shibboleth strategy:', error.message);
            }
        } else {
            console.log('ℹ️ UBC Shibboleth strategy not configured (missing environment variables)');
        }
    }

    /**
     * Serialize user for session storage
     * Stores only the user ID in the session
     * @param {Object} user - User object from authentication
     * @param {Function} done - Callback function
     */
    passport.serializeUser((user, done) => {
        // Store only the userId in the session
        done(null, user.userId);
    });

    /**
     * Deserialize user from session
     * Retrieves full user object from database using stored userId
     * @param {string} userId - User ID from session
     * @param {Function} done - Callback function
     */
    passport.deserializeUser(async (userId, done) => {
        try {
            const user = await User.getUserById(db, userId);
            if (!user) {
                // User not found - clear session
                return done(null, false);
            }
            // Return user object
            done(null, user);
        } catch (error) {
            console.error('Error deserializing user:', error);
            done(error);
        }
    });

    return passport;
}

module.exports = initializePassport;

