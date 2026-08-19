const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadHelper() {
    const context = vm.createContext({
        console,
        Date,
        encodeURIComponent,
        fetch: jest.fn(),
        setTimeout,
        window: {}
    });
    const source = fs.readFileSync(
        path.join(__dirname, '../../../public/common/scripts/topic-review.js'),
        'utf8'
    );
    vm.runInContext(source, context);
    return context.waitForUploadedDocumentParsing;
}

function response(document) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: document })
    };
}

describe('waitForUploadedDocumentParsing', () => {
    test('polls canonical document status until parsing and indexing are ready', async () => {
        const waitForParsing = loadHelper();
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response({
                documentId: 'doc-1',
                status: 'uploaded',
                metadata: { parsing: { status: 'processing' } }
            }))
            .mockResolvedValueOnce(response({
                documentId: 'doc-1',
                status: 'uploaded',
                metadata: { parsing: { status: 'ready', indexed: true, chunksStored: 3 } }
            }));
        const seen = [];

        const document = await waitForParsing('doc-1', {
            fetchImpl,
            sleep: async () => {},
            onProgress: (event) => seen.push(event.polls)
        });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(seen).toEqual([1, 2]);
        expect(document.metadata.parsing).toMatchObject({ indexed: true, chunksStored: 3 });
    });

    test('throws the persisted parse reason instead of treating failure as success', async () => {
        const waitForParsing = loadHelper();
        const fetchImpl = jest.fn(async () => response({
            documentId: 'doc-2',
            status: 'parse-failed',
            metadata: { parsing: { status: 'failed', reason: 'parse_error', message: 'Corrupt PDF.' } }
        }));

        await expect(waitForParsing('doc-2', { fetchImpl, sleep: async () => {} }))
            .rejects.toMatchObject({ message: 'Corrupt PDF.', code: 'parse_error' });
    });
});
