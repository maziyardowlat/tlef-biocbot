const { DEFAULT_LANE, LANES, laneLabel, normalizeLane } = require('../../../src/services/llmLanes');

describe('LLM lanes', () => {
    test('front-end is the backward-compatible default', () => {
        expect(DEFAULT_LANE).toBe(LANES.FRONTEND);
        expect(normalizeLane()).toBe(LANES.FRONTEND);
        expect(normalizeLane(null)).toBe(LANES.FRONTEND);
    });

    test('known lanes and labels resolve directly', () => {
        expect(normalizeLane(LANES.BACKEND)).toBe(LANES.BACKEND);
        expect(laneLabel(LANES.FRONTEND)).toMatch(/student-facing/i);
        expect(laneLabel(LANES.BACKEND)).toMatch(/processing/i);
    });

    test('an invalid explicit lane warns and falls back instead of failing a request', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(normalizeLane('backed')).toBe(LANES.FRONTEND);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('backed'));
        warn.mockRestore();
    });
});
