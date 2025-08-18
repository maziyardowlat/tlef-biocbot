require('dotenv').config();
const express = require('express');
const path = require('path');

const { MongoClient } = require('mongodb');
const coursesRoutes = require('./routes/courses');
const flagsRoutes = require('./routes/flags');
const lecturesRoutes = require('./routes/lectures');
const modeQuestionsRoutes = require('./routes/mode-questions');
const chatRoutes = require('./routes/chat');

const learningObjectivesRoutes = require('./routes/learning-objectives');
const documentsRoutes = require('./routes/documents');
const questionsRoutes = require('./routes/questions');
const onboardingRoutes = require('./routes/onboarding');
const qdrantRoutes = require('./routes/qdrant');

const app = express();
const port = process.env.TLEF_BIOCBOT_PORT || 8080;

// MongoDB connection
let db;

/**
 * Connect to MongoDB using the connection string from environment variables
 * @returns {Promise<void>}
 */
async function connectToMongoDB() {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI environment variable is not set');
        }

        const client = new MongoClient(mongoUri);
        await client.connect();
        
        // Get the database instance
        db = client.db();
        
        console.log('✅ Successfully connected to MongoDB');
        
        // Make the database available to routes
        app.locals.db = db;
        
        // Test the connection by listing collections
        const collections = await db.listCollections().toArray();
        console.log(`📚 Available collections: ${collections.map(c => c.name).join(', ') || 'None'}`);
        
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        process.exit(1);
    }
}

// Middleware for parsing request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Home page route now shows role selection
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Qdrant test page
app.get('/qdrant-test', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/qdrant-test.html'));
});

// Quick Qdrant test endpoint
app.get('/test-qdrant', async (req, res) => {
    try {
        const QdrantService = require('./services/qdrantService');
        const qdrantService = new QdrantService();
        
        console.log('🧪 Testing Qdrant connection...');
        await qdrantService.initialize();
        
        const stats = await qdrantService.getCollectionStats();
        
        res.json({
            success: true,
            message: 'Qdrant connection successful!',
            collection: stats
        });
        
    } catch (error) {
        console.error('❌ Qdrant test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Qdrant test failed',
            error: error.message
        });
    }
});

// Student routes
app.get('/student', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/student/index.html'));
});

app.get('/student/history', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/student/history.html'));
});

app.get('/student/settings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/student/settings.html'));
});

// Instructor routes - redirect to onboarding by default
app.get('/instructor', (req, res) => {
    // Check if onboarding is complete (in a real app, this would check database)
    // For now, always redirect to onboarding
    res.redirect('/instructor/onboarding');
});

// Check if user can access onboarding (not completed)
app.get('/instructor/onboarding', async (req, res) => {
    try {
        // In a real app, you'd check authentication here
        const instructorId = 'instructor-123'; // This would come from auth
        
        // Check if instructor has completed onboarding
        const db = req.app.locals.db;
        if (db) {
            const collection = db.collection('courses');
            const existingCourse = await collection.findOne({ 
                instructorId,
                isOnboardingComplete: true 
            });
            
            if (existingCourse) {
                // Redirect to course upload page if onboarding is complete
                return res.redirect(`/instructor/documents?courseId=${existingCourse.courseId}`);
            }
        }
        
        // If no completed course, show onboarding
        res.sendFile(path.join(__dirname, '../public/instructor/onboarding.html'));
        
    } catch (error) {
        console.error('Error checking onboarding status:', error);
        // If there's an error, show onboarding
        res.sendFile(path.join(__dirname, '../public/instructor/onboarding.html'));
    }
});

app.get('/instructor/settings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/instructor/settings.html'));
});



app.get('/instructor/home', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/instructor/home.html'));
});

app.get('/instructor/documents', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/instructor/index.html'));
});

app.get('/instructor/flagged', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/instructor/flagged.html'));
});

// Legacy routes (redirect to new structure)
app.get('/settings', (req, res) => {
    res.redirect('/student/settings');
});

app.get('/documents', (req, res) => {
    res.redirect('/instructor/documents');
});

// Health check endpoint to verify MongoDB connection
app.get('/api/health', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ 
                status: 'error', 
                message: 'Database not connected',
                timestamp: new Date().toISOString()
            });
        }
        
        // Test database connection by running a simple command
        await db.admin().ping();
        
        res.json({ 
            status: 'healthy', 
            message: 'Server and database are running',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'error', 
            message: 'Database connection failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoints
app.use('/api/courses', coursesRoutes);
app.use('/api/flags', flagsRoutes);
app.use('/api/lectures', lecturesRoutes);
app.use('/api/mode-questions', modeQuestionsRoutes);
app.use('/api/learning-objectives', learningObjectivesRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/qdrant', qdrantRoutes);
app.use('/api/chat', chatRoutes);

// Initialize the application
async function startServer() {
    try {
        // Connect to MongoDB first
        await connectToMongoDB();
        
        // Start the Express server
        app.listen(port, () => {
            console.log(`🚀 Server is running on http://localhost:${port}`);
            console.log(`👨‍🎓 Student interface: http://localhost:${port}/student`);
            console.log(`👨‍🏫 Instructor interface: http://localhost:${port}/instructor`);
            console.log(`🔍 Health check: http://localhost:${port}/api/health`);
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

// Start the server
startServer();
