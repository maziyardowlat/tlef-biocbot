const express = require('express');
const router = express.Router();
const multer = require('multer');

// Import the Document model and Course model
const DocumentModel = require('../models/Document');
const CourseModel = require('../models/Course');

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
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
router.use(express.json({ limit: '10mb' }));

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
            metadata: {
                description: req.body.description || '',
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
        
        console.log(`Document uploaded: ${file.originalname} for ${lectureName}`);
        
        res.json({
            success: true,
            message: 'Document uploaded successfully!',
            data: {
                documentId: result.documentId,
                filename: file.originalname,
                size: file.size,
                uploadDate: result.uploadDate,
                linkedToCourse: courseResult.success
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
        
        console.log(`Text document submitted: ${title} for ${lectureName}`);
        
        res.json({
            success: true,
            message: 'Text document submitted successfully!',
            data: {
                documentId: result.documentId,
                title: title,
                size: result.size,
                uploadDate: result.uploadDate
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
        
        // Also remove the document reference from the course structure
        if (result.success) {
            const courseResult = await CourseModel.removeDocumentFromUnit(db, document.courseId, document.lectureName, documentId, instructorId);
            if (!courseResult.success) {
                console.warn('Warning: Document deleted but failed to remove from course structure:', courseResult.error);
            }
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

module.exports = router;
