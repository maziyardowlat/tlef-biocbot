const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSelect(document) {
    return {
        value: '',
        disabled: false,
        options: [],
        replaceChildren() {
            this.options = [];
            this.value = '';
        },
        appendChild(option) {
            this.options.push(option);
            if (option.selected || (!this.value && !option.disabled)) this.value = option.value;
        },
        addEventListener: jest.fn(),
        ownerDocument: document
    };
}

function loadStudentHub(initialGradeResult, availableCoursesResult) {
    const elements = {};
    const document = {
        addEventListener: jest.fn(),
        createElement: jest.fn(() => ({
            value: '',
            textContent: '',
            disabled: false,
            selected: false
        })),
        getElementById: jest.fn((id) => elements[id] || null)
    };

    elements['lms-grade-provider'] = createSelect(document);
    elements['lms-grade-course'] = createSelect(document);
    elements['import-lms-grades'] = { disabled: false };
    elements['match-lms-students'] = { disabled: false };
    elements['link-lms-grade-course'] = { disabled: false };
    elements['connect-lms-grade-provider'] = { disabled: false, hidden: true, textContent: 'Connect LMS' };
    elements['lms-grades-bar'] = { hidden: false };
    elements['lms-grades-status'] = { textContent: '' };
    elements['lms-grades-source-note'] = { textContent: '' };
    elements['students-container'] = { innerHTML: '' };

    const responses = [initialGradeResult, availableCoursesResult].filter(Boolean);
    const authenticatedFetch = jest.fn(async () => {
        const payload = responses.shift();
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(payload)
        };
    });
    const assign = jest.fn();
    const context = vm.createContext({
        authenticatedFetch,
        clearTimeout,
        console,
        document,
        fetch: jest.fn(),
        localStorage: { getItem: jest.fn(), setItem: jest.fn() },
        setTimeout,
        showNotification: jest.fn(),
        URLSearchParams,
        window: {
            location: { assign, pathname: '/instructor/student-hub', search: '' }
        }
    });

    const source = fs.readFileSync(
        path.join(__dirname, '../../../public/instructor/scripts/student-hub.js'),
        'utf8'
    );
    vm.runInContext(source, context);
    return { context, elements, authenticatedFetch, assign };
}

describe('Student Hub LMS grade loading', () => {
    test('does not start Canvas authentication when Canvas is not linked', async () => {
        const harness = loadStudentHub({
            success: true,
            data: {
                provider: 'canvas',
                source: null,
                sources: [{ provider: 'canvas', configured: true, linked: false }],
                students: [],
                gradeItems: []
            }
        });

        await harness.context.loadLmsGrades('BIOC-302');

        expect(harness.authenticatedFetch).toHaveBeenCalledTimes(1);
        expect(harness.authenticatedFetch).toHaveBeenCalledWith('/api/lms/grades/courses/BIOC-302');
        expect(harness.assign).not.toHaveBeenCalled();
        expect(harness.elements['lms-grade-course'].disabled).toBe(true);
        expect(harness.elements['lms-grade-course'].options[0].textContent)
            .toBe('Connect Canvas to choose a course');
        expect(harness.elements['connect-lms-grade-provider']).toMatchObject({
            disabled: false,
            hidden: false,
            textContent: 'Connect Canvas'
        });
    });

    test('still loads Canvas course choices for an already linked course', async () => {
        const source = {
            provider: 'canvas',
            configured: true,
            linked: true,
            courseId: '42',
            name: 'Biochemistry 302',
            code: 'BIOC 302'
        };
        const harness = loadStudentHub(
            {
                success: true,
                data: {
                    provider: 'canvas',
                    source,
                    sources: [source],
                    students: [],
                    gradeItems: []
                }
            },
            {
                success: true,
                data: { current: source, courses: [{ id: '42', name: source.name, code: source.code }] }
            }
        );

        await harness.context.loadLmsGrades('BIOC-302');

        expect(harness.authenticatedFetch).toHaveBeenCalledTimes(2);
        expect(harness.authenticatedFetch.mock.calls[1][0])
            .toBe('/api/lms/grades/courses/BIOC-302/available-courses?provider=canvas');
        expect(harness.elements['lms-grade-course'].value).toBe('42');
    });
});
