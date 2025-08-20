const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');

// Import the Document model and Course model
const DocumentModel = require('../models/Document');
const CourseModel = require('../models/Course');
const QdrantService = require('../services/qdrantService');

// Import UBC GenAI Toolkit document parsing module
const { DocumentParsingModule } = require('ubc-genai-toolkit-document-parsing');
const { ConsoleLogger } = require('ubc-genai-toolkit-core');

// Initialize document parsing module
const docParser = new DocumentParsingModule({
    logger: new ConsoleLogger(),
    debug: true
});

// Initialize Qdrant service
const qdrantService = new QdrantService();

// Initialize Qdrant service when the module loads
(async () => {
    try {
        await qdrantService.initialize();
        console.log('✅ Qdrant service initialized in documents route');
    } catch (error) {
        console.error('❌ Failed to initialize Qdrant service in documents route:', error);
    }
})();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit (increased from 10MB)
    },
    fileFilter: (req, file, cb) => {
        // Allow common document types
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'text/markdown',
            'application/rtf'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, DOC, DOCX, TXT, MD, and RTF files are allowed.'), false);
        }
    }
});

// Middleware for JSON parsing
router.use(express.json({ limit: '50mb' }));

/**
 * POST /api/documents/upload
 * Upload a file document
 */
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const { courseId, lectureName, documentType, instructorId } = req.body;
        const file = req.file;
        
        // Validate required fields
        if (!courseId || !lectureName || !documentType || !instructorId || !file) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, lectureName, documentType, instructorId, file'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Prepare document data
        const documentData = {
            courseId,
            lectureName,
            documentType,
            instructorId,
            contentType: 'file',
            filename: file.originalname,
            originalName: file.originalname,
            fileData: file.buffer,
            mimeType: file.mimetype,
            size: file.size,
            content: '', // Initialize content field for extracted text
            metadata: {
                description: req.body.description || '',
                tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : [],
                learningObjectives: req.body.learningObjectives ? req.body.learningObjectives.split(',').map(obj => obj.trim()) : []
            }
        };
        
        // Extract text content from file using UBC GenAI Toolkit BEFORE creating the document
        let textContent = '';
        try {
            if (file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
                // Handle text files directly
                textContent = file.buffer.toString('utf8');
                console.log(`✅ Text content extracted from ${file.mimetype}: ${textContent.length} characters`);
            } else {
                // Use UBC GenAI Toolkit for PDF, DOCX, and other document types
                console.log(`🔄 Extracting text from ${file.mimetype} using UBC GenAI Toolkit...`);
                console.log(`📊 File size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
                
                // Create a temporary file path for the parser
                const tempFilePath = `/tmp/${Date.now()}_${file.originalname}`;
                
                try {
                    // Write buffer to temporary file
                    console.log(`💾 Writing file to temporary path: ${tempFilePath}`);
                    fs.writeFileSync(tempFilePath, file.buffer);
                    console.log(`✅ File written to temp path successfully`);
                    
                    // Parse document to extract text with timeout
                    console.log(`🔍 Starting document parsing...`);
                    const parsePromise = docParser.parse({ filePath: tempFilePath }, 'text');
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Document parsing timed out after 60 seconds')), 60000)
                    );
                    
                    const parseResult = await Promise.race([parsePromise, timeoutPromise]);
                    
                    if (parseResult && parseResult.content) {
                        textContent = parseResult.content;
                        console.log(`✅ Text content extracted from ${file.mimetype}: ${textContent.length} characters`);
                        console.log(`📝 Content preview: ${textContent.substring(0, 200)}...`);
                    } else {
                        throw new Error('Failed to extract text content from document');
                    }
                } finally {
                    // Clean up temporary file
                    try {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Temporary file cleaned up: ${tempFilePath}`);
                    } catch (cleanupError) {
                        console.warn(`⚠️ Failed to clean up temp file: ${cleanupError.message}`);
                    }
                }
            }
        } catch (parseError) {
            console.error(`❌ Error extracting text from ${file.mimetype}:`, parseError);
            // Continue without text extraction - document will still be stored in MongoDB
        }
        
        // Update documentData with extracted content
        if (textContent) {
            documentData.content = textContent;
            console.log(`📝 Document will be created with ${textContent.length} characters of extracted text`);
        }
        
        // Upload document to MongoDB with content already included
        const result = await DocumentModel.uploadDocument(db, documentData);
        
        // Also add document reference to the course structure
        const courseResult = await CourseModel.addDocumentToUnit(db, courseId, lectureName, {
            documentId: result.documentId,
            documentType: documentType,
            filename: file.originalname,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            status: 'uploaded',
            metadata: documentData.metadata
        }, instructorId);
        
        if (!courseResult.success) {
            console.warn('Warning: Document uploaded but failed to link to course structure:', courseResult.error);
        }
        
        // Process document through Qdrant for vector search
        let qdrantResult = null;
        if (textContent) {
            try {
                // Ensure Qdrant service is initialized
                if (!qdrantService.embeddings) {
                    console.log('Initializing Qdrant service before processing document...');
                    await qdrantService.initialize();
                }
                
                // Try to process through Qdrant for vector search
                console.log(`Processing document through Qdrant: ${file.originalname}`);
                qdrantResult = await qdrantService.processAndStoreDocument({
                    courseId,
                    lectureName,
                    documentId: result.documentId,
                    content: textContent,
                    fileName: file.originalname,
                    mimeType: file.mimetype
                });
                
                if (qdrantResult.success) {
                    console.log(`✅ Document processed and stored in Qdrant: ${qdrantResult.chunksStored} chunks`);
                } else {
                    console.warn(`⚠️ Qdrant processing failed: ${qdrantResult.error}`);
                }
            } catch (qdrantError) {
                console.warn('Warning: Document uploaded but Qdrant processing failed:', qdrantError.message);
            }
        }
        
        console.log(`Document uploaded: ${file.originalname} for ${lectureName}`);
        
        res.json({
            success: true,
            message: 'Document uploaded successfully!',
            data: {
                documentId: result.documentId,
                filename: file.originalname,
                size: file.size,
                uploadDate: result.uploadDate,
                linkedToCourse: courseResult.success,
                qdrantProcessed: qdrantResult ? qdrantResult.success : false,
                chunksStored: qdrantResult ? qdrantResult.chunksStored : 0
            }
        });
        
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while uploading document',
            error: error.message
        });
    }
});

/**
 * POST /api/documents/text
 * Submit text content as a document
 */
router.post('/text', async (req, res) => {
    try {
        const { courseId, lectureName, documentType, instructorId, content, title, description } = req.body;
        
        // Validate required fields
        if (!courseId || !lectureName || !documentType || !instructorId || !content || !title) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, lectureName, documentType, instructorId, content, title'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Prepare document data
        const documentData = {
            courseId,
            lectureName,
            documentType,
            instructorId,
            contentType: 'text',
            filename: `${title}.txt`,
            originalName: title,
            content: content,
            mimeType: 'text/plain',
            size: Buffer.byteLength(content, 'utf8'),
            metadata: {
                description: description || '',
                tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : [],
                learningObjectives: req.body.learningObjectives ? req.body.learningObjectives.split(',').map(obj => obj.trim()) : []
            }
        };
        
        // Upload document to MongoDB
        const result = await DocumentModel.uploadDocument(db, documentData);
        
        // Also add document reference to the course structure
        const courseResult = await CourseModel.addDocumentToUnit(db, courseId, lectureName, {
            documentId: result.documentId,
            documentType: documentType,
            filename: documentData.filename,
            originalName: documentData.originalName,
            mimeType: documentData.mimeType,
            size: documentData.size,
            status: 'uploaded',
            metadata: documentData.metadata
        }, instructorId);
        
        if (!courseResult.success) {
            console.warn('Warning: Text document uploaded but failed to link to course structure:', courseResult.error);
        }
        
        // Process text document through Qdrant for vector search
        let qdrantResult = null;
        try {
            // Ensure Qdrant service is initialized
            if (!qdrantService.embeddings) {
                console.log('Initializing Qdrant service before processing document...');
                await qdrantService.initialize();
            }
            
            console.log(`Processing text document through Qdrant: ${title}`);
            qdrantResult = await qdrantService.processAndStoreDocument({
                courseId,
                lectureName,
                documentId: result.documentId,
                content: content,
                fileName: title,
                mimeType: 'text/plain'
            });
            
            if (qdrantResult.success) {
                console.log(`✅ Text document processed and stored in Qdrant: ${qdrantResult.chunksStored} chunks`);
            } else {
                console.warn(`⚠️ Qdrant processing failed: ${qdrantResult.error}`);
            }
        } catch (qdrantError) {
            console.warn('Warning: Text document uploaded but Qdrant processing failed:', qdrantError.message);
        }
        
        console.log(`Text document submitted: ${title} for ${lectureName}`);
        
        res.json({
            success: true,
            message: 'Text document submitted successfully!',
            data: {
                documentId: result.documentId,
                title: title,
                size: result.size,
                uploadDate: result.uploadDate,
                linkedToCourse: courseResult.success,
                qdrantProcessed: qdrantResult ? qdrantResult.success : false,
                chunksStored: qdrantResult ? qdrantResult.chunksStored : 0
            }
        });
        
    } catch (error) {
        console.error('Error submitting text document:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while submitting text document',
            error: error.message
        });
    }
});

/**
 * GET /api/documents/lecture
 * Get all documents for a specific lecture/unit
 */
router.get('/lecture', async (req, res) => {
    try {
        const { courseId, lectureName } = req.query;
        
        if (!courseId || !lectureName) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: courseId, lectureName'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Fetch documents from MongoDB
        const documents = await DocumentModel.getDocumentsForLecture(db, courseId, lectureName);
        
        // Remove file data from response for security
        const safeDocuments = documents.map(doc => ({
            ...doc,
            fileData: undefined // Don't send binary data in response
        }));
        
        res.json({
            success: true,
            data: {
                courseId,
                lectureName,
                documents: safeDocuments,
                count: safeDocuments.length
            }
        });
        
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching documents'
        });
    }
});

/**
 * GET /api/documents/stats
 * Get document statistics for a course
 */
router.get('/stats', async (req, res) => {
    try {
        const { courseId } = req.query;
        
        if (!courseId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: courseId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Fetch document statistics from MongoDB
        const stats = await DocumentModel.getDocumentStats(db, courseId);
        
        res.json({
            success: true,
            data: {
                courseId,
                stats
            }
        });
        
    } catch (error) {
        console.error('Error fetching document stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching document stats'
        });
    }
});

/**
 * GET /api/documents/:documentId
 * Get a specific document by ID
 */
router.get('/:documentId', async (req, res) => {
    try {
        const { documentId } = req.params;
        
        if (!documentId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: documentId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Get the document from the database
        const document = await DocumentModel.getDocumentById(db, documentId);
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }
        
        console.log(`Document retrieved: ${documentId}`);
        
        res.json({
            success: true,
            message: 'Document retrieved successfully!',
            data: document
        });
        
    } catch (error) {
        console.error('Error retrieving document:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving document'
        });
    }
});

/**
 * DELETE /api/documents/:documentId
 * Delete a specific document
 */
router.delete('/:documentId', async (req, res) => {
    try {
        const { documentId } = req.params;
        const { instructorId } = req.body;
        
        if (!documentId || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: documentId, instructorId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Verify the document exists and belongs to the instructor
        const document = await DocumentModel.getDocumentById(db, documentId);
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }
        
        if (document.instructorId !== instructorId) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to delete this document'
            });
        }
        
        // Delete the document from the documents collection
        const result = await DocumentModel.deleteDocument(db, documentId);
        
        // DELETE FROM BOTH DATABASES - SIMPLE AND DIRECT
        if (result.success) {
            console.log(`Document deleted from documents collection, now deleting from course structure...`);
            
            // Get the course collection directly
            const coursesCollection = db.collection('courses');
            
            // DELETE FROM COURSE STRUCTURE - NO FANCY LOGIC
            const courseDeleteResult = await coursesCollection.updateOne(
                { courseId: document.courseId },
                { 
                    $pull: { 
                        'lectures.$[].documents': { documentId: documentId } 
                    }
                }
            );
            
            console.log(`Course delete result:`, courseDeleteResult);
            console.log(`Document ${documentId} deleted from BOTH databases`);
        }
        
        console.log(`Document deleted: ${documentId} by instructor ${instructorId}`);
        
        res.json({
            success: true,
            message: 'Document deleted successfully!',
            data: {
                documentId,
                deletedCount: result.deletedCount,
                removedFromCourse: result.success
            }
        });
        
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting document'
        });
    }
});

/**
 * POST /api/documents/cleanup-orphans
 * Clean up orphaned document references in course structure
 */
router.post('/cleanup-orphans', async (req, res) => {
    try {
        const { courseId, instructorId } = req.body;
        
        if (!courseId || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, instructorId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Get the course
        const course = await CourseModel.getCourseWithOnboarding(db, courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check each document reference and remove orphaned ones
        let totalOrphans = 0;
        let cleanedUnits = 0;
        
        if (course.lectures) {
            for (const unit of course.lectures) {
                if (unit.documents && unit.documents.length > 0) {
                    const validDocuments = [];
                    for (const doc of unit.documents) {
                        try {
                            const docExists = await DocumentModel.getDocumentById(db, doc.documentId);
                            if (docExists) {
                                validDocuments.push(doc);
                            } else {
                                totalOrphans++;
                                console.log(`Found orphaned document: ${doc.documentId} in unit ${unit.name}`);
                            }
                        } catch (error) {
                            console.log(`Error checking document ${doc.documentId}:`, error);
                            totalOrphans++;
                        }
                    }
                    
                    // Update the unit with only valid documents
                    if (validDocuments.length !== unit.documents.length) {
                        unit.documents = validDocuments;
                        unit.updatedAt = new Date();
                        cleanedUnits++;
                    }
                }
            }
            
            // Update the course if any changes were made
            if (totalOrphans > 0) {
                const result = await CourseModel.upsertCourse(db, course);
                console.log(`Cleaned up ${totalOrphans} orphaned documents from ${cleanedUnits} units`);
            }
        }
        
        res.json({
            success: true,
            message: `Cleanup completed. Removed ${totalOrphans} orphaned documents from ${cleanedUnits} units.`,
            data: {
                totalOrphans,
                cleanedUnits
            }
        });
        
    } catch (error) {
        console.error('Error cleaning up orphaned documents:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while cleaning up orphaned documents'
        });
    }
});

module.exports = router;
