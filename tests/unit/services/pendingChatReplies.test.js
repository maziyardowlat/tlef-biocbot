/**
 * The store that keeps each conversation's latest chat outcome, so a page that
 * reloads mid-reply can still show the reply.
 */
const pendingChatReplies = require('../../../src/services/pendingChatReplies');

const conversation = { userId: 's1', courseId: 'C1', conversationId: 'autosave_1' };
const reply = { success: true, messageId: 'msg_1', message: 'Glycolysis happens in the cytosol.' };

beforeEach(() => {
    pendingChatReplies.clear();
});
afterEach(() => {
    jest.useRealTimers();
});

test('a request is pending until it settles, then ready with the body it responded with', () => {
    const settle = pendingChatReplies.start(conversation);

    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'pending', body: null, isExplanationRequest: false });

    settle(200, reply);

    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'ready', body: reply });
});

test.each([
    ['an error status', 500, { success: false, message: 'Sorry, I encountered an error processing your message.' }],
    ['a 2xx without success', 200, { success: false, message: 'No' }],
    ['no body', 200, undefined]
])('%s is kept as failed, without the body', (_, status, body) => {
    pendingChatReplies.start(conversation)(status, body);

    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'failed', body: null });
});

test('it remembers whether the request was an Explain click', () => {
    pendingChatReplies.start({ ...conversation, isExplanationRequest: true })(200, reply);

    expect(pendingChatReplies.get(conversation).isExplanationRequest).toBe(true);
});

test('a newer request in the conversation replaces the last one, and the older one finishing later changes nothing', () => {
    const first = pendingChatReplies.start(conversation);
    const second = pendingChatReplies.start(conversation);

    first(200, { ...reply, messageId: 'msg_old' });
    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'pending' });

    second(200, reply);
    first(200, { ...reply, messageId: 'msg_old' });
    expect(pendingChatReplies.get(conversation).body.messageId).toBe('msg_1');
});

test('only the first result of a request counts', () => {
    const settle = pendingChatReplies.start(conversation);
    settle(200, reply);
    settle(500, { success: false });

    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'ready', body: reply });
});

test('each student, course and conversation has its own entry', () => {
    pendingChatReplies.start(conversation)(200, reply);

    expect(pendingChatReplies.get({ ...conversation, userId: 's2' })).toBeNull();
    expect(pendingChatReplies.get({ ...conversation, courseId: 'C2' })).toBeNull();
    expect(pendingChatReplies.get({ ...conversation, conversationId: 'autosave_2' })).toBeNull();
});

test.each([
    ['no conversation id', { ...conversation, conversationId: undefined }],
    ['an empty conversation id', { ...conversation, conversationId: '' }],
    ['a conversation id that is not a string', { ...conversation, conversationId: { $ne: null } }],
    ['an over-long conversation id', { ...conversation, conversationId: 'x'.repeat(201) }],
    ['no user', { ...conversation, userId: undefined }],
    ['no course', { ...conversation, courseId: undefined }]
])('a request with %s is not kept', (_, request) => {
    expect(pendingChatReplies.start(request)).toBeNull();
    expect(pendingChatReplies.get(request)).toBeNull();
});

test('an entry is dropped once it is older than KEEP_MS', () => {
    jest.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z') });
    pendingChatReplies.start(conversation)(200, reply);

    jest.setSystemTime(Date.now() + pendingChatReplies.KEEP_MS);
    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'ready' });

    jest.setSystemTime(Date.now() + 1);
    expect(pendingChatReplies.get(conversation)).toBeNull();
});

test('the time counts from when the reply finished, not when it was asked for', () => {
    jest.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z') });
    const settle = pendingChatReplies.start(conversation);

    jest.setSystemTime(Date.now() + pendingChatReplies.KEEP_MS - 1000);
    settle(200, reply);
    jest.setSystemTime(Date.now() + 2000);

    expect(pendingChatReplies.get(conversation)).toMatchObject({ state: 'ready' });
});

test('past MAX_ENTRIES the least recently changed entry goes first', () => {
    const ids = Array.from({ length: pendingChatReplies.MAX_ENTRIES + 1 }, (_, i) => ({ ...conversation, conversationId: `autosave_${i}` }));
    const settleFirst = pendingChatReplies.start(ids[0]);
    ids.slice(1, -1).forEach(id => pendingChatReplies.start(id));
    // Finishing moves the first entry to the back.
    settleFirst(200, reply);

    pendingChatReplies.start(ids.at(-1));

    expect(pendingChatReplies.get(ids[0])).toMatchObject({ state: 'ready' });
    expect(pendingChatReplies.get(ids[1])).toBeNull();
    expect(pendingChatReplies.get(ids.at(-1))).toMatchObject({ state: 'pending' });
});
