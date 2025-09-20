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

// Instructor routes - serve documents page directly
app.get('/instructor', (req, res) => {
    // Serve the documents page directly
    res.sendFile(path.join(__dirname, '../public/instructor/index.html'));
});

// Also handle /instructor/ (with trailing slash)
app.get('/instructor/', (req, res) => {
    // Serve the documents page directly
    res.sendFile(path.join(__dirname, '../public/instructor/index.html'));
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

// Health check endpoint to verify all services
app.get('/api/health', async (req, res) => {
    const healthStatus = {
        status: 'checking',
        timestamp: new Date().toISOString(),
        services: {},
        environment: {
            NODE_ENV: process.env.NODE_ENV,
            LLM_PROVIDER: process.env.LLM_PROVIDER,
            QDRANT_URL: process.env.QDRANT_URL ? 'SET' : 'NOT SET',
            OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT ? 'SET' : 'NOT SET'
        }
    };
    
    try {
        // Test MongoDB connection
        if (!db) {
            healthStatus.services.mongodb = { status: 'error', message: 'Database not connected' };
        } else {
            try {
                await db.admin().ping();
                healthStatus.services.mongodb = { status: 'healthy', message: 'Connected' };
            } catch (error) {
                healthStatus.services.mongodb = { status: 'error', message: error.message };
            }
        }
        
        // Test configuration loading
        try {
            const config = require('./services/config');
            const llmConfig = config.getLLMConfig();
            const vectorConfig = config.getVectorDBConfig();
            healthStatus.services.config = { 
                status: 'healthy', 
                message: 'Configuration loaded successfully',
                llmProvider: llmConfig.provider,
                vectorHost: vectorConfig.host,
                vectorPort: vectorConfig.port
            };
        } catch (error) {
            healthStatus.services.config = { status: 'error', message: error.message };
        }
        
        // Test Qdrant connection
        try {
            const QdrantService = require('./services/qdrantService');
            const qdrantService = new QdrantService();
            await qdrantService.initialize();
            healthStatus.services.qdrant = { status: 'healthy', message: 'Connected' };
        } catch (error) {
            healthStatus.services.qdrant = { status: 'error', message: error.message };
        }
        
        // Test LLM connection
        try {
            const llmService = require('./services/llm');
            const isConnected = await llmService.testConnection();
            healthStatus.services.llm = { 
                status: isConnected ? 'healthy' : 'error', 
                message: isConnected ? 'Connected' : 'Connection failed',
                provider: llmService.getProviderName()
            };
        } catch (error) {
            healthStatus.services.llm = { status: 'error', message: error.message };
        }
        
        // Determine overall status
        const allHealthy = Object.values(healthStatus.services).every(service => service.status === 'healthy');
        healthStatus.status = allHealthy ? 'healthy' : 'degraded';
        healthStatus.message = allHealthy ? 'All services are running' : 'Some services are not available';
        
        const statusCode = allHealthy ? 200 : 503;
        res.status(statusCode).json(healthStatus);
        
    } catch (error) {
        healthStatus.status = 'error';
        healthStatus.message = 'Health check failed';
        healthStatus.error = error.message;
        res.status(503).json(healthStatus);
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
