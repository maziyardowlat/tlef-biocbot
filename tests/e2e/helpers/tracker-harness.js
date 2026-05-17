// @ts-nocheck
/**
 * Coverage harness for src/services/tracker.js.
 *
 * Exercises every documented branch:
 *   - well-formed JSON response with mapped + unmapped topics
 *   - confidence-too-low → 'unmapped'
 *   - approvedTopics not an array, contains non-string entries
 *   - response wrapped in markdown fences and extraneous prose
 *   - empty LLM response
 *   - LLM throws (catch path)
 */

const assert = require('assert/strict');
const path = require('path');
const v8 = require('v8');

const TrackerService = require(path.resolve(__dirname, '../../../src/services/tracker'));

class FakeLLM {
    constructor() { this.queue = []; this.calls = []; }
    enqueue(response) { this.queue.push(response); }
    async sendMessage(prompt, opts) {
        this.calls.push({ prompt, opts });
        const next = this.queue.shift();
        if (next instanceof Error) throw next;
        return next;
    }
}

async function run() {
    // ---- happy path: mapped topic, fenced response, extra prose ----
    {
        const llm = new FakeLLM();
        llm.enqueue({
            content: 'Some preamble\n```json\n' +
                '{"isStruggling": true, "rawTopic": "krebs cycle", "mappedTopic": "Cellular Respiration", "matchConfidence": 0.8, "reason": "looks confused"}' +
                '\n```\nand a trailing note',
        });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage(
            "I don't get how the citric acid cycle produces ATP",
            'BIOC202',
            'Unit 3',
            ['Cellular Respiration', 'DNA Replication']
        );
        assert.equal(result.isMapped, true);
        assert.equal(result.topic, 'Cellular Respiration');
        assert.equal(result.isStruggling, true);
        assert.equal(result.rawTopic, 'krebs cycle');
        assert.equal(result.reason, 'looks confused');
    }

    // ---- confidence too low → unmapped ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: '{"isStruggling": true, "rawTopic": "x", "mappedTopic": "Cellular Respiration", "matchConfidence": 0.3, "reason": "weak"}' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['Cellular Respiration']);
        assert.equal(result.isMapped, false);
        assert.equal(result.topic, 'unmapped');
        assert.equal(result.matchConfidence, 0.3);
    }

    // ---- mappedTopic NOT in approved list → unmapped ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: '{"isStruggling": false, "mappedTopic": "Something Else", "matchConfidence": 0.95}' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['Cellular Respiration']);
        assert.equal(result.isMapped, false);
        assert.equal(result.topic, 'unmapped');
    }

    // ---- approvedTopics not an array — falls through to clean=[] ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: '{"isStruggling": false, "rawTopic": "anything", "mappedTopic": "unmapped", "matchConfidence": 0.0}' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', /** @type {any} */ ('not-an-array'));
        assert.equal(result.isMapped, false);
        assert.equal(result.topic, 'unmapped');
    }

    // ---- approvedTopics contains non-string entries / whitespace — filtered out ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: '{"isStruggling": true, "mappedTopic": "  cellular respiration  ", "matchConfidence": 0.9}' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['  ', 123, null, 'Cellular Respiration']);
        // mappedTopic has leading/trailing whitespace and case difference — trim/lowercase match
        assert.equal(result.topic, 'Cellular Respiration');
        assert.equal(result.isMapped, true);
    }

    // ---- empty content → "not struggling" fallback ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: '' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['T']);
        assert.equal(result.isStruggling, false);
        assert.equal(result.topic, 'unmapped');
        assert.equal(result.reason, 'Empty LLM response');
    }

    // ---- content without JSON braces → tries to parse whole thing → throws → catch path ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: 'no json here' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['T']);
        assert.equal(result.isStruggling, false);
        assert.equal(result.reason, 'Error');
    }

    // ---- LLM throws ----
    {
        const llm = new FakeLLM();
        llm.enqueue(new Error('boom'));
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['T']);
        assert.equal(result.isStruggling, false);
        assert.equal(result.topic, 'unmapped');
        assert.equal(result.reason, 'Error');
    }

    // ---- LLM returns no content field at all ----
    {
        const llm = new FakeLLM();
        llm.enqueue({});
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', []);
        assert.equal(result.isStruggling, false);
        assert.equal(result.reason, 'Empty LLM response');
    }

    // ---- matchConfidence missing / non-number → defaults to 0 → unmapped ----
    {
        const llm = new FakeLLM();
        llm.enqueue({ content: '{"isStruggling": true, "mappedTopic": "Cellular Respiration"}' });
        const svc = new TrackerService(llm);
        const result = await svc.analyzeMessage('msg', 'C', 'U', ['Cellular Respiration']);
        assert.equal(result.isMapped, false);
        assert.equal(result.matchConfidence, 0);
    }
}

run()
    .then(() => {
        try { v8.takeCoverage(); } catch { /* coverage disabled */ }
    })
    .catch((err) => {
        console.error(err);
        try { v8.takeCoverage(); } catch { /* coverage disabled */ }
        process.exitCode = 1;
    });
