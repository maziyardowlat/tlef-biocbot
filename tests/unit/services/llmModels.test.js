const models = require('../../../src/services/llmModels');

describe('provider-aware LLM model catalog', () => {
    test('exposes the OpenAI catalog and preserves existing reasoning rules', () => {
        const catalog = models.catalogForProvider('openai', 'gpt-5-nano');
        expect(catalog.defaultModel).toBe('gpt-5-nano');
        expect(catalog.allowedModels).toContain('gpt-4.1-mini');
        expect(catalog.reasoningEffortsByModel['gpt-5-nano']).toEqual(['minimal', 'low', 'medium', 'high']);
        expect(catalog.defaultReasoningEffortByModel).toMatchObject({
            'gpt-5-nano': 'minimal',
            'gpt-5.4-nano': 'low',
            'gpt-5.6-luna': 'low'
        });
        expect(models.normalizeReasoningEffort('openai', 'gpt-5.4-nano', 'minimal')).toBe('low');
        expect(models.supportsReasoning('openai', 'gpt-4.1-mini')).toBe(false);
    });

    test('exposes b3000 sandbox models and safe defaults', () => {
        const catalog = models.catalogForProvider('ubc-llm-sandbox', 'qwen3.6-35b-a3b');
        expect(catalog.allowedModels).toEqual(['qwen3.6-35b-a3b', 'gpt-oss-120b']);
        expect(catalog.defaultReasoningEffortByModel).toEqual({
            'qwen3.6-35b-a3b': 'none',
            'gpt-oss-120b': 'low'
        });
        expect(models.normalizeReasoningEffort('ubc-llm-sandbox', 'qwen3.6-35b-a3b')).toBe('none');
        expect(models.normalizeReasoningEffort('ubc-llm-sandbox', 'gpt-oss-120b', 'minimal')).toBe('low');
        expect(models.maxOutputTokensForModel('ubc-llm-sandbox', 'qwen3.6-35b-a3b')).toBe(4096);
        expect(models.maxOutputTokensForModel('ubc-llm-sandbox', 'gpt-oss-120b')).toBeNull();
    });

    test('keeps a newly configured sandbox model selectable', () => {
        const catalog = models.catalogForProvider('ubc-llm-sandbox', 'future-model');
        expect(catalog.defaultModel).toBe('future-model');
        expect(catalog.allowedModels).toContain('future-model');
        expect(catalog.reasoningEffortsByModel['future-model']).toContain('none');
    });

    test('limits Ollama selection to its configured local model', () => {
        expect(models.catalogForProvider('ollama', 'llama3.1')).toMatchObject({
            defaultModel: 'llama3.1',
            allowedModels: ['llama3.1']
        });
    });
});
