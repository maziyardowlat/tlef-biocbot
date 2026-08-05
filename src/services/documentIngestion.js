const fs = require('fs');
const os = require('os');
const path = require('path');

const DocumentModel = require('../models/Document');
const CourseModel = require('../models/Course');
const FlashcardDeck = require('../models/FlashcardDeck');
const gridfs = require('./gridfs');
const { DocumentParsingModule } = require('ubc-genai-toolkit-document-parsing');
const { ConsoleLogger } = require('ubc-genai-toolkit-core');

const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const SUPPORTED_DOCUMENT_MIME_TYPES = Object.freeze([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    PPTX_MIME_TYPE,
    'text/plain',
    'text/markdown',
    'application/rtf'
]);

function isSupportedDocumentMimeType(mimeType) {
    return SUPPORTED_DOCUMENT_MIME_TYPES.includes(String(mimeType || '').toLowerCase());
}

function createDocumentParser(options = {}) {
    const llmService = options.llmService || null;
    return new DocumentParsingModule({
        logger: new ConsoleLogger(),
        debug: true,
        imageConcurrency: 4,
        onSlide: options.onSlide,
        imageDescriber: async (image) => {
            try {
                if (!llmService || typeof llmService.isReady !== 'function' || !llmService.isReady()) {
                    return null;
                }
                return await llmService.describeImage(image.data, image.mimeType, {
                    slideNumber: image.slideNumber,
                    pageNumber: image.pageNumber,
                    source: image.source
                });
            } catch (error) {
                if (error?.name === 'LlmKeyError') throw error;
                const where = image.slideNumber
                    ? `slide ${image.slideNumber}`
                    : (image.pageNumber ? `page ${image.pageNumber}` : `image ${image.imageIndex}`);
                console.warn(`⚠️ imageDescriber failed (${where}): ${error.message}`);
                return null;
            }
        }
    });
}

async function parseDocumentBuffer({ buffer, originalName, mimeType, llmService }) {
    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
        return { textContent: buffer.toString('utf8'), parsedSlides: [] };
    }

    const parsedSlides = [];
    const safeName = path.basename(originalName || 'document');
    const tempFilePath = path.join(os.tmpdir(), `${Date.now()}_${safeName}`);

    try {
        fs.writeFileSync(tempFilePath, buffer);
        const parser = createDocumentParser({
            llmService,
            onSlide: mimeType === PPTX_MIME_TYPE
                ? async (slide) => {
                    if (slide && typeof slide.text === 'string' && slide.text.trim()) {
                        parsedSlides.push(slide);
                    }
                }
                : undefined
        });
        const parsePromise = parser.parse({ filePath: tempFilePath }, 'text');
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error('Document parsing timed out after 5 minutes')),
                5 * 60 * 1000
            );
        });

        let parseResult;
        try {
            parseResult = await Promise.race([parsePromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId);
        }

        if (!parseResult?.content) {
            throw new Error('Failed to extract text content from document');
        }

        return { textContent: parseResult.content, parsedSlides };
    } finally {
        try {
            fs.unlinkSync(tempFilePath);
        } catch (error) {
            console.warn(`⚠️ Failed to clean up temporary document: ${error.message}`);
        }
    }
}

/**
 * Wraps a caller-supplied progress callback so a failing or missing listener
 * can never break an ingestion that is otherwise succeeding.
 */
function createProgressEmitter(onProgress) {
    if (typeof onProgress !== 'function') return () => {};
    return (phase, details = {}) => {
        try {
            onProgress({ phase, ...details });
        } catch (error) {
            console.warn(`⚠️ Ingestion progress listener failed on "${phase}": ${error.message}`);
        }
    };
}

async function ingestDocument({
    db,
    qdrantService,
    documentData,
    storedInstructorId,
    linkTitle,
    qdrantData,
    indexDocument,
    onProgress
}) {
    const emit = createProgressEmitter(onProgress);
    emit('saving');
    const result = await DocumentModel.uploadDocument(db, documentData);
    const courseResult = await CourseModel.addDocumentToUnit(
        db,
        documentData.courseId,
        documentData.lectureName,
        {
            documentId: result.documentId,
            documentType: documentData.documentType,
            ...(linkTitle ? { title: linkTitle } : {}),
            filename: documentData.filename,
            originalName: documentData.originalName,
            mimeType: documentData.mimeType,
            size: documentData.size,
            status: 'uploaded',
            metadata: documentData.metadata
        },
        storedInstructorId
    );

    let qdrantResult = null;
    if (documentData.content) {
        emit('indexing');
        try {
            const payload = { ...qdrantData, documentId: result.documentId, type: result.type };
            qdrantResult = indexDocument
                ? await indexDocument(payload)
                : await qdrantService.processAndStoreDocument(payload);
        } catch (error) {
            if (error?.name === 'LlmKeyError') throw error;
            console.warn('Warning: Document uploaded but Qdrant processing failed:', error.message);
        }
    }

    await FlashcardDeck.markUnitStale(db, documentData.courseId, documentData.lectureName);
    return { result, courseResult, qdrantResult };
}

async function ingestFileBuffer({
    db,
    ai,
    buffer,
    originalName,
    mimeType,
    size,
    courseId,
    lectureName,
    documentType,
    instructorId,
    title,
    metadata = {},
    onProgress
}) {
    const emit = createProgressEmitter(onProgress);
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('Document buffer is required');
    }
    if (!isSupportedDocumentMimeType(mimeType)) {
        const error = new Error('Invalid file type. Only PDF, DOC, DOCX, PPTX, TXT, MD, and RTF files are allowed.');
        error.code = 'UNSUPPORTED_DOCUMENT_TYPE';
        throw error;
    }
    if (buffer.length > MAX_DOCUMENT_BYTES || Number(size) > MAX_DOCUMENT_BYTES) {
        const error = new Error('Document exceeds the 50 MB file-size limit.');
        error.code = 'DOCUMENT_TOO_LARGE';
        throw error;
    }

    const effectiveSize = Number(size) || buffer.length;
    const effectiveName = path.basename(originalName || 'document');
    emit('storing', { filename: effectiveName, size: effectiveSize });
    const gridfsFileId = await gridfs.uploadBuffer(db, buffer, effectiveName, {
        contentType: mimeType,
        metadata: { courseId, lectureName, originalName: effectiveName }
    });

    let textContent = '';
    let parsedSlides = [];
    emit('extracting', { mimeType });
    try {
        ({ textContent, parsedSlides } = await parseDocumentBuffer({
            buffer,
            originalName: effectiveName,
            mimeType,
            llmService: ai.llm
        }));
    } catch (error) {
        console.error(`❌ Error extracting text from ${mimeType}:`, error);
    }
    emit('extracted', { characters: textContent.length, slides: parsedSlides.length });

    const filename = title || effectiveName;
    const documentData = {
        courseId,
        lectureName,
        documentType,
        instructorId,
        contentType: 'file',
        filename,
        originalName: effectiveName,
        fileId: gridfsFileId,
        mimeType,
        size: effectiveSize,
        content: textContent,
        metadata: {
            description: '',
            tags: [],
            learningObjectives: [],
            ...metadata
        }
    };

    const qdrantService = ai.qdrant;
    const indexSlides = mimeType === PPTX_MIME_TYPE && parsedSlides.length > 0
        ? async (qdrantDocumentData) => {
            const nonBlankSlides = parsedSlides.filter((slide) => slide.text && slide.text.trim());
            const slideChunks = nonBlankSlides.map((slide) => slide.text.trim());
            const slideMetadata = nonBlankSlides.map((slide) => ({
                sourceUnit: 'slide',
                slideNumber: slide.slideNumber,
                describedImageCount: slide.describedImageCount || 0
            }));
            const embeddings = await qdrantService.generateEmbeddings(slideChunks);
            const storedChunks = await qdrantService.storeChunks(
                { ...qdrantDocumentData, chunkMetadata: slideMetadata },
                slideChunks,
                embeddings,
                'pptx-slide'
            );
            return {
                success: true,
                chunksProcessed: slideChunks.length,
                chunksStored: storedChunks.length,
                message: `PowerPoint processed and ${storedChunks.length} slide chunks stored successfully`
            };
        }
        : null;

    return ingestDocument({
        db,
        qdrantService,
        documentData,
        storedInstructorId: instructorId,
        linkTitle: title || filename,
        qdrantData: {
            courseId,
            lectureName,
            content: textContent,
            fileName: filename,
            mimeType,
            documentType
        },
        indexDocument: indexSlides,
        onProgress
    });
}

module.exports = {
    MAX_DOCUMENT_BYTES,
    PPTX_MIME_TYPE,
    SUPPORTED_DOCUMENT_MIME_TYPES,
    createDocumentParser,
    createProgressEmitter,
    ingestDocument,
    ingestFileBuffer,
    isSupportedDocumentMimeType,
    parseDocumentBuffer
};
