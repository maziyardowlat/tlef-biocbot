const prompts = require('../../../src/services/prompts');

describe('prompts.createQuestionGenerationSystemPrompt', () => {
    test('interpolates the question type and JSON schema into the prompt', () => {
        const schema = '{"type":"string"}';
        const out = prompts.createQuestionGenerationSystemPrompt('multiple-choice', schema);
        expect(out).toContain('create a multiple-choice question');
        expect(out).toContain(schema);
        expect(out).toContain('CRITICAL FORMAT REQUIREMENTS');
    });
});

describe('prompts.QUESTION_GENERATION_PROMPT_TEMPLATE', () => {
    const { trueFalse, multipleChoice, shortAnswer } = prompts.QUESTION_GENERATION_PROMPT_TEMPLATE;

    test('each template uses its default example values when called with no args', () => {
        expect(trueFalse()).toContain('Unit 1: Cell Structure');
        expect(multipleChoice()).toContain('Unit 2: Cell Energy');
        expect(shortAnswer()).toContain('Unit 3: Cellular Respiration');
    });

    test('custom learning objectives / material / unit are interpolated', () => {
        const out = multipleChoice('Objective Z', 'Material Q', 'Unit 9: Enzymes');
        expect(out).toContain('Objective Z');
        expect(out).toContain('Material Q');
        expect(out).toContain('Unit 9: Enzymes');
        expect(out).toContain('multiple-choice question for Unit 9: Enzymes');
    });

    test('templates wrap objectives and materials in the expected tags', () => {
        const out = trueFalse('LO', 'CM', 'U1');
        expect(out).toContain('<learning_objectives>\nLO\n</learning_objectives>');
        expect(out).toContain('<reading_materials>\nCM\n</reading_materials>');
    });
});

describe('prompts.buildQuestionExtractionPrompt', () => {
    test('embeds the source text inside the triple-quote block', () => {
        const out = prompts.buildQuestionExtractionPrompt('Q1: Enzymes are proteins. True.');
        expect(out).toContain('"""\nQ1: Enzymes are proteins. True.\n"""');
        expect(out).toContain('Return JSON ONLY');
    });
});

describe('prompts.buildPracticeQuestionPrompt', () => {
    afterEach(() => jest.restoreAllMocks());

    function withRandom(value, fn) {
        jest.spyOn(Math, 'random').mockReturnValue(value);
        return fn();
    }

    test('Math.random near 0 selects multiple-choice', () => {
        const out = withRandom(0, () => prompts.buildPracticeQuestionPrompt('SEED-MC'));
        expect(out).toContain('**multiple-choice** practice question');
        expect(out).toContain('Provide exactly 4 options (A, B, C, D)');
        expect(out).toContain('SEED-MC');
    });

    test('Math.random in the middle band selects true-false', () => {
        const out = withRandom(0.4, () => prompts.buildPracticeQuestionPrompt('SEED-TF'));
        expect(out).toContain('**true-false** practice question');
        expect(out).toContain('Do NOT include an "options" field');
        expect(out).toContain('SEED-TF');
    });

    test('Math.random near 1 selects short-answer', () => {
        const out = withRandom(0.99, () => prompts.buildPracticeQuestionPrompt('SEED-SA'));
        expect(out).toContain('**short-answer** practice question');
        expect(out).toContain('concise expected answer');
        expect(out).toContain('SEED-SA');
    });

    test('a topic adds a study hint; null omits it', () => {
        const withTopic = withRandom(0, () => prompts.buildPracticeQuestionPrompt('seed', 'Glycolysis'));
        expect(withTopic).toContain('currently studying the topic: "Glycolysis"');

        jest.restoreAllMocks();
        const noTopic = withRandom(0, () => prompts.buildPracticeQuestionPrompt('seed', null));
        expect(noTopic).not.toContain('currently studying the topic');
    });
});

describe('prompts.buildQuestionObjectiveLinkingPrompt', () => {
    test('falls back to "(none provided)" when both lists are empty', () => {
        const out = prompts.buildQuestionObjectiveLinkingPrompt([], []);
        // Both the objectives and questions sections render the placeholder.
        expect(out.match(/\(none provided\)/g)).toHaveLength(2);
    });

    test('numbers the learning objectives', () => {
        const out = prompts.buildQuestionObjectiveLinkingPrompt(['Understand X', 'Understand Y'], []);
        expect(out).toContain('1. Understand X');
        expect(out).toContain('2. Understand Y');
    });

    test('formats a question with ref, type, options, and correct answer', () => {
        const out = prompts.buildQuestionObjectiveLinkingPrompt(['LO1'], [{
            ref: 'q1',
            questionType: 'multiple-choice',
            question: 'What is ATP?',
            options: { A: 'energy', B: 'protein' },
            correctAnswer: 'A',
        }]);
        expect(out).toContain('1. ref="q1" [multiple-choice] What is ATP?');
        expect(out).toContain('Options: A. energy | B. protein');
        expect(out).toContain('Correct answer: A');
    });

    test('derives ref/type fallbacks and omits empty option/answer lines', () => {
        const out = prompts.buildQuestionObjectiveLinkingPrompt(['LO1'], [
            { question: 'No ref here' },                       // ref -> q1, type -> unknown
            { questionId: 'qid-2', type: 'true-false', question: 'Has questionId' },
        ]);
        expect(out).toContain('1. ref="q1" [unknown] No ref here');
        expect(out).toContain('2. ref="qid-2" [true-false] Has questionId');
        expect(out).not.toContain('Options:');
        expect(out).not.toContain('Correct answer:');
    });
});

describe('prompts exported constants', () => {
    test('DEFAULT_PROMPTS exposes every chat mode as a non-empty string', () => {
        for (const key of ['base', 'protege', 'tutor', 'explain', 'directive', 'quizHelp', 'flashcards']) {
            expect(typeof prompts.DEFAULT_PROMPTS[key]).toBe('string');
            expect(prompts.DEFAULT_PROMPTS[key].length).toBeGreaterThan(0);
        }
    });

    test('DEFAULT_SUPER_COURSE_CHAT_SETTINGS has the documented defaults', () => {
        const s = prompts.DEFAULT_SUPER_COURSE_CHAT_SETTINGS;
        expect(s).toMatchObject({
            studentTopK: 8,
            instructorTopK: 8,
            includeInactiveCourses: false,
            showStudentSuperCourse: false,
            includeNotesInRetrieval: true,
            noteRetrievalRatio: 0.25,
            noteMinScore: 0.25,
        });
        expect(Object.keys(s.studentLevelModifiers)).toEqual(prompts.STUDENT_LEVEL_KEYS);
        expect(Object.keys(s.instructorLevelModifiers)).toEqual(prompts.INSTRUCTOR_LEVEL_KEYS);
    });

    test('level keys and defaults line up', () => {
        expect(prompts.STUDENT_LEVEL_KEYS).toEqual(['intro', 'undergraduate', 'graduate']);
        expect(prompts.INSTRUCTOR_LEVEL_KEYS).toEqual(['overview', 'standard', 'deepDive']);
        expect(prompts.STUDENT_LEVEL_KEYS).toContain(prompts.DEFAULT_STUDENT_LEVEL);
        expect(prompts.INSTRUCTOR_LEVEL_KEYS).toContain(prompts.DEFAULT_INSTRUCTOR_LEVEL);
    });

    test('QUESTION_EXTRACTION_SYSTEM_PROMPT demands strict JSON', () => {
        expect(prompts.QUESTION_EXTRACTION_SYSTEM_PROMPT).toContain('strict JSON');
    });
});

describe('chemistry and math formatting rules', () => {
    const rules = [
        'CRITICAL LaTeX FORMATTING',
        'CRITICAL SMILES FORMATTING',
        '[SMILES]C1=CC=CC=C1[/SMILES]'
    ];

    test('the editable flashcard template leaves the rules to the unit toggle', () => {
        // flashcardService appends them when "Chemistry notation" is ticked, so
        // an instructor editing this template cannot strand them in the middle.
        expect(prompts.FLASHCARD_GENERATION_PROMPT).not.toContain('CRITICAL SMILES FORMATTING');
        expect(prompts.DEFAULT_PROMPTS.flashcards).toBe(prompts.FLASHCARD_GENERATION_PROMPT);
    });

    test('the question generation system prompt carries both rules', () => {
        const out = prompts.createQuestionGenerationSystemPrompt('short-answer', '{}');
        for (const rule of rules) {
            expect(out).toContain(rule);
        }
    });

    test('the editable question prompt defaults carry both rules', () => {
        for (const rule of rules) {
            expect(prompts.DEFAULT_QUESTION_PROMPTS.systemPrompt).toContain(rule);
        }
    });

    test('the rules name the delimiters the client actually renders', () => {
        expect(prompts.RICH_CONTENT_FORMATTING_RULES).toContain('\\( H_2O \\)');
        expect(prompts.RICH_CONTENT_FORMATTING_RULES).toContain('Do NOT use parentheses () or $ as math delimiters');
    });

    test('appendRichContentFormattingRules adds the rules to a custom prompt', () => {
        const out = prompts.appendRichContentFormattingRules('Write five questions.');
        expect(out).toContain('Write five questions.');
        expect(out).toContain('CRITICAL SMILES FORMATTING');
    });

    test('appendRichContentFormattingRules never doubles up', () => {
        const once = prompts.appendRichContentFormattingRules('Write five questions.');
        expect(prompts.appendRichContentFormattingRules(once)).toBe(once);
        const questionPrompt = prompts.createQuestionGenerationSystemPrompt('true-false', '{}');
        expect(prompts.appendRichContentFormattingRules(questionPrompt)).toBe(questionPrompt);
    });

    test('appendRichContentFormattingRules adds only the missing rule', () => {
        const smilesOnly = 'Write five questions.\n\nCRITICAL SMILES FORMATTING: existing rule';
        const withLatex = prompts.appendRichContentFormattingRules(smilesOnly);
        expect(withLatex).toContain('CRITICAL LaTeX FORMATTING');
        expect(withLatex.match(/CRITICAL SMILES FORMATTING/g)).toHaveLength(1);

        const latexOnly = 'Write five questions.\n\nCRITICAL LaTeX FORMATTING: existing rule';
        const withSmiles = prompts.appendRichContentFormattingRules(latexOnly);
        expect(withSmiles).toContain('CRITICAL SMILES FORMATTING');
        expect(withSmiles.match(/CRITICAL LaTeX FORMATTING/g)).toHaveLength(1);
    });

    test('appendRichContentFormattingRules tolerates empty input', () => {
        expect(prompts.appendRichContentFormattingRules(null)).toContain('CRITICAL LaTeX FORMATTING');
    });
});
