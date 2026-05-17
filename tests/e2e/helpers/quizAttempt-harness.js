// @ts-nocheck
/**
 * Coverage harness for src/models/QuizAttempt.js — specifically the parts that
 * aren't reachable through the quiz API route file:
 *   - getAttemptsByStudent (exported but never imported by a route)
 *   - getAttemptStats with results.length === 0 (no-attempts fallback)
 *   - saveAttempt with no `feedback` field (falsy default branch)
 *   - getAttemptStats unitBreakdown growing across multiple attempts in the
 *     same lectureName plus the false-branch of `if (entry.correct)`
 */

const assert = require('assert/strict');
const path = require('path');
const v8 = require('v8');

const QuizAttempt = require(path.resolve(__dirname, '../../../src/models/QuizAttempt'));

class FakeQuizCollection {
    constructor() {
        this.inserted = [];
        this.aggregateResults = [];
    }

    async insertOne(doc) {
        this.inserted.push(doc);
        return { acknowledged: true, insertedId: 'fake-id' };
    }

    find(filter) {
        this.lastFindFilter = filter;
        const matches = this.inserted.filter((d) => {
            for (const [k, v] of Object.entries(filter)) {
                if (d[k] !== v) return false;
            }
            return true;
        });
        return {
            sort: (sortSpec) => {
                this.lastSort = sortSpec;
                return {
                    toArray: async () => matches,
                };
            },
        };
    }

    aggregate(pipeline) {
        this.lastPipeline = pipeline;
        return {
            toArray: async () => this.aggregateResults,
        };
    }
}

function makeDb(coll) {
    return {
        collection(name) {
            assert.equal(name, 'quizAttempts');
            return coll;
        },
    };
}

async function run() {
    // ---- saveAttempt with no feedback (falsy → '') ----
    {
        const coll = new FakeQuizCollection();
        const result = await QuizAttempt.saveAttempt(makeDb(coll), {
            studentId: 's1',
            courseId: 'C',
            questionId: 'q1',
            lectureName: 'Unit 1',
            questionType: 'multiple-choice',
            studentAnswer: 'A',
            correct: false,
        });
        assert.equal(result.success, true);
        assert.match(result.attemptId, /^qa_/);
        assert.equal(coll.inserted[0].feedback, '');
        assert.equal(coll.inserted[0].correct, false);
    }

    // ---- saveAttempt with explicit feedback ----
    {
        const coll = new FakeQuizCollection();
        await QuizAttempt.saveAttempt(makeDb(coll), {
            studentId: 's2',
            courseId: 'C',
            questionId: 'q2',
            lectureName: 'Unit 1',
            questionType: 'true-false',
            studentAnswer: 'true',
            correct: true,
            feedback: 'Nice!',
        });
        assert.equal(coll.inserted[0].feedback, 'Nice!');
    }

    // ---- getAttemptsByStudent (not used by routes) ----
    {
        const coll = new FakeQuizCollection();
        coll.inserted = [
            { studentId: 's1', courseId: 'C', attemptedAt: new Date() },
            { studentId: 's1', courseId: 'OTHER', attemptedAt: new Date() },
        ];
        const list = await QuizAttempt.getAttemptsByStudent(makeDb(coll), 's1', 'C');
        assert.equal(list.length, 1);
        assert.equal(list[0].courseId, 'C');
        assert.deepEqual(coll.lastSort, { attemptedAt: -1 });
    }

    // ---- getAttemptStats with no results → fallback object ----
    {
        const coll = new FakeQuizCollection();
        coll.aggregateResults = [];
        const stats = await QuizAttempt.getAttemptStats(makeDb(coll), 's-none', 'C');
        assert.deepEqual(stats, {
            totalAttempts: 0,
            correctCount: 0,
            accuracy: 0,
            unitBreakdown: {},
        });
    }

    // ---- getAttemptStats with multi-unit, correct + incorrect ----
    {
        const coll = new FakeQuizCollection();
        coll.aggregateResults = [{
            _id: null,
            totalAttempts: 4,
            correctCount: 3,
            byUnit: [
                { lectureName: 'Unit 1', correct: true },
                { lectureName: 'Unit 1', correct: false }, // exercises false branch
                { lectureName: 'Unit 1', correct: true },
                { lectureName: 'Unit 2', correct: true },
            ],
        }];
        const stats = await QuizAttempt.getAttemptStats(makeDb(coll), 's1', 'C');
        assert.equal(stats.totalAttempts, 4);
        assert.equal(stats.correctCount, 3);
        assert.equal(stats.accuracy, 75);
        assert.deepEqual(stats.unitBreakdown, {
            'Unit 1': { total: 3, correct: 2 },
            'Unit 2': { total: 1, correct: 1 },
        });
    }

    // ---- getAttemptStats with totalAttempts=0 in aggregate (defensive accuracy branch) ----
    {
        const coll = new FakeQuizCollection();
        coll.aggregateResults = [{
            _id: null,
            totalAttempts: 0,
            correctCount: 0,
            byUnit: [],
        }];
        const stats = await QuizAttempt.getAttemptStats(makeDb(coll), 's1', 'C');
        assert.equal(stats.accuracy, 0);
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
