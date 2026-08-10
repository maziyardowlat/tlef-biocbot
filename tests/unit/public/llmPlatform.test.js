describe('LLM platform saved-key actions', () => {
    const elements = {};

    beforeEach(() => {
        jest.resetModules();
        for (const key of Object.keys(elements)) delete elements[key];

        elements['course-llm-platform-help'] = { textContent: '', innerHTML: '' };
        elements['course-llm-key-input'] = { value: '', placeholder: '' };
        elements['save-course-llm-key'] = { disabled: false, textContent: 'Save key' };
        elements['course-llm-platform-change-note'] = { hidden: true, textContent: '' };
        elements['course-llm-provider-ubc-llm-sandbox'] = {
            checked: true,
            value: 'ubc-llm-sandbox'
        };

        global.document = {
            getElementById: jest.fn(id => elements[id] || null),
            querySelector: jest.fn(selector => selector === 'input[name="course-llm-provider"]:checked'
                ? elements['course-llm-provider-ubc-llm-sandbox']
                : null)
        };
        delete global.LlmPlatform;
        require('../../../public/common/scripts/llm-platform');
    });

    afterEach(() => {
        delete global.document;
        delete global.LlmPlatform;
    });

    test('offers a switch when the alternate platform already has a stored key', () => {
        global.LlmPlatform.refreshSelector('course', {
            llmProvider: 'openai',
            llmKeysByProvider: {
                'ubc-llm-sandbox': { status: 'valid', last4: '2222' }
            }
        });

        expect(elements['save-course-llm-key'].textContent).toBe('Switch to Sandbox');
        expect(elements['course-llm-key-input'].placeholder)
            .toBe('Optional: enter a replacement Sandbox key');
        expect(elements['course-llm-platform-change-note'].textContent)
            .toContain('keeps your saved Sandbox key');
    });

    test('changes back to saving when a replacement key is entered', () => {
        elements['course-llm-key-input'].value = 'replacement-key';

        global.LlmPlatform.refreshSelector('course', {
            llmProvider: 'openai',
            llmKeysByProvider: {
                'ubc-llm-sandbox': { status: 'valid', last4: '2222' }
            }
        });

        expect(elements['save-course-llm-key'].textContent).toBe('Save key');
    });
});
