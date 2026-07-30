const { encodingForModel } = require('js-tiktoken');
const DocumentModel = require('../models/Document');
const FlashcardDeck = require('../models/FlashcardDeck');

const tokenEncoder = encodingForModel('gpt-4o');
const DEFAULT_CARD_COUNT = 10;
const MAX_SOURCE_TOKENS = 12000;
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

function buildSourceRecords(documents, maxTokens = MAX_SOURCE_TOKENS) {
    const perDocument = documents.map((document) => {
        const chunks = splitIntoChunks(document.content);
        return {
            document,
            chunks,
            indexes: stratifiedIndexes(chunks.length),
            cursor: 0
        };
    }).filter(entry => entry.chunks.length > 0);

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

            const text = entry.chunks[index];
            const sourceTokens = countTokens(text) + 30;
            if (usedTokens + sourceTokens > maxTokens) continue;

            selected.push({
                sourceRef: `S${selected.length + 1}`,
                documentId: entry.document.documentId,
                fileName: entry.document.originalName || entry.document.filename || 'Course material',
                chunkIndex: index,
                text
            });
            usedTokens += sourceTokens;
        }
    }
    return selected;
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
        if (front.length > 300 || back.length > 1200) continue;

        seen.add(key);
        cards.push({
            front,
            back,
            source: {
                documentId: source.documentId,
                fileName: source.fileName,
                chunkIndex: source.chunkIndex
            }
        });
        if (cards.length >= requestedCount) break;
    }

    if (cards.length === 0) {
        throw new Error('The AI response did not contain any valid source-grounded cards');
    }
    return cards;
}

function buildPrompt({ lectureName, cardCount, learningObjectives, sourceRecords }) {
    const objectives = Array.isArray(learningObjectives) && learningObjectives.length
        ? learningObjectives.map((objective, index) => `${index + 1}. ${String(objective).trim()}`).join('\n')
        : 'No learning objectives were provided.';
    const sources = sourceRecords.map(source => (
        `[${source.sourceRef}] ${source.fileName}, section ${source.chunkIndex + 1}\n${source.text}`
    )).join('\n\n---\n\n');

    return `Generate ${cardCount} university-level study flashcards for ${lectureName}.

Use only the supplied course material. Do not add facts from outside knowledge.
Each card must test one clear concept, process, relationship, or definition.
Prefer conceptual understanding over trivia. Avoid duplicate or near-duplicate cards.
Keep the front concise and make the back complete enough to study independently.
Every card must cite exactly one source label from the supplied material.

Return only a JSON object using this schema:
{
  "cards": [
    {
      "front": "Question or prompt",
      "back": "Source-grounded answer",
      "sourceRef": "S1"
    }
  ]
}

Learning objectives:
${objectives}

Course material:
${sources}`;
}

async function generateDeck({ db, llmService, course, lectureName, cardCount, generatedBy }) {
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

    const sourceRecords = buildSourceRecords(documents);
    if (sourceRecords.length === 0) {
        throw new Error('The uploaded materials did not contain enough text to generate flashcards');
    }

    const prompt = buildPrompt({
        lectureName,
        cardCount: requestedCount,
        learningObjectives: lecture.learningObjectives || [],
        sourceRecords
    });
    const response = await llmService.sendMessage(prompt, {
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
    MAX_SOURCE_TOKENS,
    splitIntoChunks,
    stratifiedIndexes,
    buildSourceRecords,
    parseGeneratedCards,
    buildPrompt,
    generateDeck
};
