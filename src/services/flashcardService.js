const { encodingForModel } = require('js-tiktoken');
const DocumentModel = require('../models/Document');
const FlashcardDeck = require('../models/FlashcardDeck');
const prompts = require('./prompts');
const { LANES } = require('./llmLanes');

const tokenEncoder = encodingForModel('gpt-4o');
const DEFAULT_CARD_COUNT = 10;
const DEFAULT_SOURCE_TOKEN_BUDGET = 12000;
const MIN_SOURCE_TOKENS = 2000;
const MAX_SOURCE_TOKENS = 50000;
const MAX_CHUNK_CHARACTERS = 2400;

function countTokens(text) {
    return tokenEncoder.encode(String(text || '')).length;
}

function splitIntoChunks(content) {
    const paragraphs = String(content || '')
        .replace(/\r/g, '')
        .split(/\n{2,}/)
        .map(value => value.replace(/\s+/g, ' ').trim())
        .filter(value => value.length >= 30);

    const chunks = [];
    let current = '';
    for (const paragraph of paragraphs) {
        if (paragraph.length > MAX_CHUNK_CHARACTERS) {
            if (current) {
                chunks.push(current);
                current = '';
            }
            for (let start = 0; start < paragraph.length; start += MAX_CHUNK_CHARACTERS) {
                chunks.push(paragraph.slice(start, start + MAX_CHUNK_CHARACTERS));
            }
            continue;
        }

        if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARACTERS) {
            chunks.push(current);
            current = paragraph;
        } else {
            current = current ? `${current}\n\n${paragraph}` : paragraph;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function stratifiedIndexes(length) {
    if (length <= 1) return length === 1 ? [0] : [];
    const candidates = [0, length - 1, Math.floor(length / 2), Math.floor(length / 4), Math.floor((length * 3) / 4)];
    for (let i = 1; i < length; i += 1) candidates.push(i);
    return [...new Set(candidates)].filter(index => index >= 0 && index < length);
}

function selectSourceRecords(perDocument, maxTokens) {
    const selected = [];
    let usedTokens = 0;
    let madeProgress = true;

    while (madeProgress) {
        madeProgress = false;
        for (const entry of perDocument) {
            const index = entry.indexes[entry.cursor];
            if (index === undefined) continue;
            entry.cursor += 1;
            madeProgress = true;

            const chunk = entry.chunks[index];
            const sourceTokens = countTokens(chunk.text) + 30;
            if (usedTokens + sourceTokens > maxTokens) continue;

            selected.push({
                sourceRef: `S${selected.length + 1}`,
                documentId: entry.document.documentId,
                fileName: chunk.fileName || entry.document.originalName || entry.document.filename || 'Course material',
                chunkIndex: Number.isInteger(chunk.chunkIndex) ? chunk.chunkIndex : index,
                pageNumber: Number.isInteger(chunk.pageNumber) ? chunk.pageNumber : null,
                slideNumber: Number.isInteger(chunk.slideNumber) ? chunk.slideNumber : null,
                text: chunk.text
            });
            usedTokens += sourceTokens;
        }
    }
    return selected;
}

function buildSourceRecords(documents, maxTokens = DEFAULT_SOURCE_TOKEN_BUDGET) {
    const perDocument = documents.map((document) => {
        const chunks = splitIntoChunks(document.content).map((text, chunkIndex) => ({ text, chunkIndex }));
        return {
            document,
            chunks,
            indexes: stratifiedIndexes(chunks.length),
            cursor: 0
        };
    }).filter(entry => entry.chunks.length > 0);

    return selectSourceRecords(perDocument, maxTokens);
}

function buildSourceRecordsFromStoredChunks(documents, storedChunks, maxTokens = DEFAULT_SOURCE_TOKEN_BUDGET) {
    const currentDocumentIds = new Set(documents.map(document => document.documentId));
    const storedByDocument = new Map();
    for (const chunk of Array.isArray(storedChunks) ? storedChunks : []) {
        if (!currentDocumentIds.has(chunk?.documentId)) continue;
        const text = String(chunk.chunkText || '').trim();
        if (!text) continue;
        if (!storedByDocument.has(chunk.documentId)) storedByDocument.set(chunk.documentId, []);
        storedByDocument.get(chunk.documentId).push({
            text,
            fileName: chunk.fileName,
            chunkIndex: Number.isInteger(chunk.chunkIndex) ? chunk.chunkIndex : null,
            pageNumber: Number.isInteger(chunk.pageNumber) ? chunk.pageNumber : null,
            slideNumber: Number.isInteger(chunk.slideNumber) ? chunk.slideNumber : null
        });
    }

    const perDocument = documents.map(document => {
        let chunks = storedByDocument.get(document.documentId) || [];
        chunks.sort((a, b) => Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));
        if (chunks.length === 0) {
            chunks = splitIntoChunks(document.content).map((text, chunkIndex) => ({ text, chunkIndex }));
        }
        return {
            document,
            chunks,
            indexes: stratifiedIndexes(chunks.length),
            cursor: 0
        };
    }).filter(entry => entry.chunks.length > 0);

    return selectSourceRecords(perDocument, maxTokens);
}

function normalizeSourceTokenBudget(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < MIN_SOURCE_TOKENS || parsed > MAX_SOURCE_TOKENS) {
        return DEFAULT_SOURCE_TOKEN_BUDGET;
    }
    return parsed;
}

function hasVagueSourceReference(front) {
    const text = String(front || '');
    return [
        /\bbased on\s+(?:(?:the|this|that)\s+)?(?:lecture|slides?|figures?|images?|diagrams?|graphs?|tables?|course materials?|notes?)\b/i,
        /\b(?:the|this|that|above|below|following|shown|provided)\s+(?:figures?|images?|diagrams?|graphs?|tables?|slides?|lectures?|notes?|materials?)\b/i,
        /\b(?:figures?|images?|diagrams?|graphs?|tables?|slides?)\s+(?:above|below|shown|provided)\b/i,
        /\b(?:figure|fig\.?|image|diagram|graph|table|slide)\s*#?\d+\b/i
    ].some(pattern => pattern.test(text));
}

function parseGeneratedCards(content, sourceRecords, requestedCount) {
    const raw = String(content || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The AI response did not contain valid JSON');

    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed.cards)) throw new Error('The AI response did not contain a cards array');

    const sources = new Map(sourceRecords.map(source => [source.sourceRef, source]));
    const seen = new Set();
    const cards = [];
    for (const candidate of parsed.cards) {
        const front = String(candidate?.front || '').replace(/\s+/g, ' ').trim();
        const back = String(candidate?.back || '').replace(/\s+/g, ' ').trim();
        const source = sources.get(String(candidate?.sourceRef || '').trim());
        const key = front.toLowerCase();
        if (!front || !back || !source || seen.has(key)) continue;
        if (hasVagueSourceReference(front)) continue;
        if (front.length > 300 || back.length > 1200) continue;

        seen.add(key);
        cards.push({
            front,
            back,
            source: {
                documentId: source.documentId,
                fileName: source.fileName,
                chunkIndex: source.chunkIndex,
                pageNumber: source.pageNumber,
                slideNumber: source.slideNumber
            }
        });
        if (cards.length >= requestedCount) break;
    }

    if (cards.length === 0) {
        throw new Error('The AI response did not contain any valid source-grounded cards');
    }
    return cards;
}

function replacePromptPlaceholder(template, name, value) {
    return template.split(`{{${name}}}`).join(value);
}

function buildPrompt({ lectureName, cardCount, learningObjectives, sourceRecords, promptTemplate }) {
    const objectives = Array.isArray(learningObjectives) && learningObjectives.length
        ? learningObjectives.map((objective, index) => `${index + 1}. ${String(objective).trim()}`).join('\n')
        : 'No learning objectives were provided.';
    const sources = sourceRecords.map(source => {
        const location = source.slideNumber
            ? `slide ${source.slideNumber}`
            : (source.pageNumber ? `page ${source.pageNumber}` : `section ${source.chunkIndex + 1}`);
        return `[${source.sourceRef}] ${source.fileName}, ${location}\n${source.text}`;
    }).join('\n\n---\n\n');

    const template = typeof promptTemplate === 'string' && promptTemplate.trim()
        ? promptTemplate.trim()
        : prompts.DEFAULT_PROMPTS.flashcards;
    const includesObjectives = template.includes('{{learningObjectives}}');
    const includesCourseMaterial = template.includes('{{courseMaterial}}');
    let rendered = template;
    rendered = replacePromptPlaceholder(rendered, 'cardCount', String(cardCount));
    rendered = replacePromptPlaceholder(rendered, 'lectureName', String(lectureName));
    rendered = replacePromptPlaceholder(rendered, 'learningObjectives', objectives);
    rendered = replacePromptPlaceholder(rendered, 'courseMaterial', sources);

    if (!includesObjectives) {
        rendered += `\n\nLearning objectives:\n${objectives}`;
    }
    if (!includesCourseMaterial) {
        rendered += `\n\nCourse material:\n${sources}`;
    }

    return `${rendered}

Non-negotiable generation contract:
- Generate exactly ${cardCount} cards.
- Use only the supplied course material; do not add facts from outside knowledge.
- Every card must cite exactly one source label from the supplied material.
- Every question must be self-contained and understandable without opening the cited source.
- Never refer vaguely to "the lecture," "the figure," "the image," "the graph," "the table," "the slide," or surrounding material. State the specific biological or chemical subject directly.
- Do not ask students to interpret an unseen visual. Convert useful visual information into an explicit question about the named structure, variables, trend, or process.
- Return only a JSON object using this schema:
{
  "cards": [
    {
      "front": "Question or prompt",
      "back": "Source-grounded answer",
      "sourceRef": "S1"
    }
  ]
}`;
}

async function generateDeck({
    db,
    llmService,
    qdrantService,
    course,
    lectureName,
    cardCount,
    generatedBy,
    promptTemplate,
    sourceTokenBudget
}) {
    const requestedCount = Number.isInteger(cardCount) ? cardCount : DEFAULT_CARD_COUNT;
    if (requestedCount < 5 || requestedCount > FlashcardDeck.MAX_CARD_COUNT) {
        throw new Error(`Card count must be between 5 and ${FlashcardDeck.MAX_CARD_COUNT}`);
    }

    const lecture = (course.lectures || []).find(unit => unit.name === lectureName);
    if (!lecture) throw new Error('Unit not found');

    const documents = (await DocumentModel.getDocumentsForLecture(db, course.courseId, lectureName))
        .filter(document => typeof document.content === 'string' && document.content.trim());
    if (documents.length === 0) {
        throw new Error('No parsed course material is available for this unit');
    }

    const tokenBudget = normalizeSourceTokenBudget(sourceTokenBudget);
    let storedChunks = [];
    if (qdrantService && typeof qdrantService.getUnitChunkRecords === 'function') {
        try {
            storedChunks = await qdrantService.getUnitChunkRecords(
                course.courseId,
                lectureName,
                documents.map(document => document.documentId)
            );
        } catch (error) {
            console.warn('Unable to load indexed chunks for flashcard generation; using parsed document text:', error.message);
        }
    }
    const sourceRecords = buildSourceRecordsFromStoredChunks(documents, storedChunks, tokenBudget);
    if (sourceRecords.length === 0) {
        throw new Error('The uploaded materials did not contain enough text to generate flashcards');
    }

    const prompt = buildPrompt({
        lectureName,
        cardCount: requestedCount,
        learningObjectives: lecture.learningObjectives || [],
        sourceRecords,
        promptTemplate
    });
    const response = await llmService.sendMessage(prompt, {
        lane: LANES.BACKEND,
        temperature: 0.2,
        maxTokens: 4000,
        response_format: { type: 'json_object' }
    });
    const cards = parseGeneratedCards(response?.content, sourceRecords, requestedCount);

    return FlashcardDeck.saveGeneratedDraft(db, {
        courseId: course.courseId,
        lectureName,
        title: `${lecture.displayName || lectureName} Flashcards`,
        cards,
        sourceDocumentIds: documents.map(document => document.documentId),
        generatedBy
    });
}

module.exports = {
    DEFAULT_CARD_COUNT,
    DEFAULT_SOURCE_TOKEN_BUDGET,
    MIN_SOURCE_TOKENS,
    MAX_SOURCE_TOKENS,
    splitIntoChunks,
    stratifiedIndexes,
    buildSourceRecords,
    buildSourceRecordsFromStoredChunks,
    normalizeSourceTokenBudget,
    hasVagueSourceReference,
    parseGeneratedCards,
    buildPrompt,
    generateDeck
};
