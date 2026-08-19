const fs = require('fs');
const os = require('os');
const path = require('path');

const DocumentModel = require('../models/Document');
const CourseModel = require('../models/Course');
const FlashcardDeck = require('../models/FlashcardDeck');
const gridfs = require('./gridfs');
const {
    contentHash,
    markDocumentIndexFailed,
    markDocumentIndexReady
} = require('./embeddingIndexService');
const { DocumentParsingModule } = require('ubc-genai-toolkit-document-parsing');
const { ConsoleLogger } = require('ubc-genai-toolkit-core');
const {
    collectChunks,
    describeReason,
    getDocParse,
    shouldUseDocParse,
    submitDocument
} = require('./docparse');

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

async function recordParseFailure(db, documentId, reason, message = describeReason(reason)) {
    await DocumentModel.updateDocumentStatus(db, documentId, 'parse-failed', {
        'metadata.parsing.status': 'failed',
        'metadata.parsing.reason': reason,
        'metadata.parsing.message': message,
        'metadata.parsing.finishedAt': new Date()
    }).catch((error) => console.warn(`⚠️ Could not record parse failure: ${error.message}`));
    return { success: false, reason, message, chunksStored: 0 };
}

async function documentExists(db, documentId) {
    return Boolean(await DocumentModel.getDocumentById(db, documentId));
}

async function removePartialChunks(qdrantService, documentId, courseId) {
    if (typeof qdrantService?.deleteDocumentChunks !== 'function') return;
    await qdrantService.deleteDocumentChunks(documentId, courseId).catch((error) => {
        console.warn(`⚠️ Could not remove partial chunks for ${documentId}: ${error.message}`);
    });
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
        const profile = qdrantService && qdrantService.embeddingProfile;
        const hash = contentHash(documentData.content);
        try {
            const payload = { ...qdrantData, documentId: result.documentId, type: result.type };
            qdrantResult = indexDocument
                ? await indexDocument(payload)
                : await qdrantService.processAndStoreDocument(payload);

            // Record which embedding profile now has current vectors for this
            // document. Other profiles stay untouched, so a later switch only
            // re-embeds what is genuinely missing.
            if (profile && qdrantResult && qdrantResult.success !== false) {
                await markDocumentIndexReady(db, result.documentId, profile, hash);
            }
        } catch (error) {
            if (profile) {
                await markDocumentIndexFailed(db, result.documentId, profile, hash, error).catch(() => {});
            }
            if (error?.name === 'LlmKeyError') throw error;
            console.warn('Warning: Document uploaded but Qdrant processing failed:', error.message);
        }
    }

    await FlashcardDeck.markUnitStale(db, documentData.courseId, documentData.lectureName);
    return { result, courseResult, qdrantResult };
}

/**
 * Everything that happens once the parsing service has finished with a job.
 *
 * Runs detached from every upload request. Tests may await it through the
 * internal `awaitParse` seam, but production callers observe the persisted
 * state instead. It must always reach a terminal state: a document left saying
 * "processing" forever is worse than one that says it failed.
 *
 * Results live one hour from the terminal state and then answer 410, so this
 * collects and stores them as soon as the job is done rather than deferring to
 * a later user action.
 */
async function finishDocParseJob({
    db,
    ai,
    docparse,
    jobId,
    documentId,
    documentType,
    type,
    courseId,
    lectureName,
    filename,
    mimeType,
    emit
}) {
    const { client, config, tracker } = docparse;
    const qdrantService = ai.qdrant;

    try {
        const final = await tracker.track(jobId, {
            onStatus: ({ status, reason, polls }) => emit('parsing', { jobId, status, reason, polls })
        });
        const reason = final.reason || null;

        if (final.status !== 'done') {
            const message = describeReason(reason);
            console.error(`❌ Parsing service did not complete ${filename} (${final.status}/${reason}): ${message}`);
            return recordParseFailure(db, documentId, reason, message);
        }

        // A user can delete a document while its service job is still running.
        // Stop before fetching or indexing results rather than resurrecting it in Qdrant.
        if (!(await documentExists(db, documentId))) {
            return { success: false, reason: 'document_deleted', message: describeReason('document_deleted'), chunksStored: 0 };
        }

        // `metadata` is null until terminal. Warnings such as
        // image_description_unavailable do not invalidate otherwise intact text.
        const warnings = final.metadata?.warnings || [];
        if (warnings.length > 0) {
            console.log(`ℹ️ Parsing service warnings for ${filename}: ${warnings.join(', ')}`);
        }

        let collected;
        try {
            collected = await collectChunks({ client, jobId });
        } catch (error) {
            error.reason = error.reason || 'result_error';
            throw error;
        }
        const { texts, chunkMetadata, textContent } = collected;
        if (texts.length === 0) {
            const message = 'The parsing service returned no text for this document.';
            console.error(`❌ ${message} (${filename})`);
            return recordParseFailure(db, documentId, 'empty_result', message);
        }

        emit('saving');
        const saved = await DocumentModel.updateDocumentContent(db, documentId, textContent);
        if (!saved?.success) {
            const error = new Error(saved?.error || 'Parsed document content could not be saved');
            error.reason = 'persistence_error';
            throw error;
        }

        emit('indexing');
        const profile = qdrantService && qdrantService.embeddingProfile;
        const hash = contentHash(textContent);
        let qdrantResult = { success: false, chunksProcessed: texts.length, chunksStored: 0 };
        const storedChunks = [];
        try {
            const batchSize = config.embedBatchSize || 100;
            for (let offset = 0; offset < texts.length; offset += batchSize) {
                if (!(await documentExists(db, documentId))) {
                    await removePartialChunks(qdrantService, documentId, courseId);
                    return { success: false, reason: 'document_deleted', message: describeReason('document_deleted'), chunksStored: 0 };
                }

                const batchTexts = texts.slice(offset, offset + batchSize);
                const batchMetadata = chunkMetadata.slice(offset, offset + batchSize);
                const embeddings = await qdrantService.generateEmbeddings(batchTexts);
                const storedBatch = await qdrantService.storeChunks(
                    {
                        courseId,
                        lectureName,
                        documentId,
                        type,
                        fileName: filename,
                        mimeType,
                        documentType,
                        chunkMetadata: batchMetadata,
                        chunkIndexOffset: offset,
                        totalChunks: texts.length
                    },
                    batchTexts,
                    embeddings,
                    `docparse-${config.chunkStrategy}`
                );
                storedChunks.push(...storedBatch);
            }

            // Close the deletion race after the final upsert as well.
            if (!(await documentExists(db, documentId))) {
                await removePartialChunks(qdrantService, documentId, courseId);
                return { success: false, reason: 'document_deleted', message: describeReason('document_deleted'), chunksStored: 0 };
            }

            qdrantResult = {
                success: true,
                chunksProcessed: texts.length,
                chunksStored: storedChunks.length,
                message: `Document parsed and ${storedChunks.length} chunks stored successfully`
            };
            if (profile) await markDocumentIndexReady(db, documentId, profile, hash);
        } catch (error) {
            await removePartialChunks(qdrantService, documentId, courseId);
            if (profile) {
                await markDocumentIndexFailed(db, documentId, profile, hash, error).catch(() => {});
            }
            console.warn('Warning: Document parsed but Qdrant processing failed:', error.message);
            qdrantResult.error = error.message;
        }

        const statusResult = await DocumentModel.updateDocumentStatus(db, documentId, 'uploaded', {
            'metadata.parsing.status': 'ready',
            'metadata.parsing.reason': null,
            'metadata.parsing.warnings': warnings,
            'metadata.parsing.chunkCount': texts.length,
            'metadata.parsing.chunksStored': qdrantResult.chunksStored,
            'metadata.parsing.indexed': qdrantResult.success,
            'metadata.parsing.finishedAt': new Date()
        });
        if (!statusResult?.matchedCount) {
            await removePartialChunks(qdrantService, documentId, courseId);
            return { success: false, reason: 'document_deleted', message: describeReason('document_deleted'), chunksStored: 0 };
        }
        await FlashcardDeck.markUnitStale(db, courseId, lectureName);
        return qdrantResult;
    } catch (error) {
        const reason = error.reason || 'persistence_error';
        const message = error.message || describeReason(reason);
        console.error(`❌ Background parse completion failed for ${filename} (${jobId}): ${message}`);
        await removePartialChunks(qdrantService, documentId, courseId);
        if (!(await documentExists(db, documentId))) {
            return { success: false, reason: 'document_deleted', message: describeReason('document_deleted'), chunksStored: 0 };
        }
        return recordParseFailure(db, documentId, reason, message);
    }
}

/**
 * Ingest a document through the UBC Document Parsing API instead of the
 * in-process parser.
 *
 * The shape differs from the legacy path in one important way: the Mongo
 * document is written BEFORE the text exists, carrying `metadata.parsing` so
 * the UI can tell "still parsing" from "parsed and empty". That is what lets
 * the upload request return immediately instead of holding a connection open
 * for the length of the parse.
 */
async function ingestViaDocParse({
    db,
    ai,
    docparse,
    buffer,
    effectiveName,
    effectiveSize,
    mimeType,
    gridfsFileId,
    courseId,
    lectureName,
    documentType,
    instructorId,
    title,
    metadata,
    emit,
    awaitParse
}) {
    const { client, config } = docparse;

    // Creating the job and streaming the bytes to the gateway is a byte
    // transfer, not a parse — a sample lecture measured 164ms — so this much is
    // safe to await inside a request handler. The parse is watched separately.
    emit('extracting', { mimeType, parser: 'docparse' });
    const { jobId } = await submitDocument({
        client,
        config,
        buffer,
        originalName: effectiveName,
        mimeType
    });

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
        content: '',
        metadata: {
            description: '',
            tags: [],
            learningObjectives: [],
            ...metadata,
            parsing: {
                provider: 'docparse',
                jobId,
                status: 'processing',
                startedAt: new Date()
            }
        }
    };

    // Written before the text exists so the file is listed immediately and the
    // background finisher has a row to update. The `saving` phase is emitted
    // later, when the parsed content actually lands, to keep the progress
    // stream moving forwards.
    const result = await DocumentModel.uploadDocument(db, documentData);
    const courseResult = await CourseModel.addDocumentToUnit(
        db,
        courseId,
        lectureName,
        {
            documentId: result.documentId,
            documentType,
            ...(title ? { title } : {}),
            filename,
            originalName: effectiveName,
            mimeType,
            size: effectiveSize,
            status: 'uploaded',
            metadata: documentData.metadata
        },
        instructorId
    );
    await FlashcardDeck.markUnitStale(db, courseId, lectureName);

    const finish = () => finishDocParseJob({
        db,
        ai,
        docparse,
        jobId,
        documentId: result.documentId,
        documentType,
        type: result.type,
        courseId,
        lectureName,
        filename,
        mimeType,
        emit
    });

    // Kept as an internal/testing seam only. Request handlers must leave this
    // false: browser polling reports completion without holding HTTP open.
    if (awaitParse) {
        return { result, courseResult, qdrantResult: await finish(), jobId };
    }

    finish().catch((error) => {
        console.error(`❌ Background parse of ${filename} (job ${jobId}) failed: ${error.message}`);
    });
    return { result, courseResult, qdrantResult: null, jobId };
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
    onProgress,
    awaitParse = false,
    env = process.env
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

    // Only some formats go to the parsing service — PPTX and DOCX keep the
    // in-process describer, and .doc/.rtf are rejected there outright. See
    // docparse/config.js for why each one is where it is. Everything that
    // answers false below, and every format when DOCPARSE_ENABLED is off,
    // follows exactly the same path it did before this integration.
    const docparse = getDocParse(env);
    if (docparse && shouldUseDocParse(mimeType, docparse.config)) {
        return ingestViaDocParse({
            db,
            ai,
            docparse,
            buffer,
            effectiveName,
            effectiveSize,
            mimeType,
            gridfsFileId,
            courseId,
            lectureName,
            documentType,
            instructorId,
            title,
            metadata,
            emit,
            awaitParse
        });
    }

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
    finishDocParseJob,
    ingestDocument,
    ingestFileBuffer,
    ingestViaDocParse,
    isSupportedDocumentMimeType,
    parseDocumentBuffer
};
