// @ts-nocheck
const assert = require('assert/strict');
const path = require('path');
const v8 = require('v8');
const PersistenceTopic = require(path.resolve(__dirname, '../../../src/models/PersistenceTopic'));

class FakePersistenceCollection {
    constructor() {
        this.findOneAndUpdateQueue = [];
        this.updateOneCalls = [];
        this.findCalls = [];
        this.sortedTopics = [];
    }

    async findOneAndUpdate(filter, update, options) {
        this.lastFindOneAndUpdate = { filter, update, options };
        const next = this.findOneAndUpdateQueue.shift();
        if (!next) throw new Error('No fake findOneAndUpdate result queued');
        return next;
    }

    async updateOne(filter, update) {
        this.updateOneCalls.push({ filter, update });
        return { acknowledged: true, modifiedCount: 1 };
    }

    find(filter) {
        this.findCalls.push(filter);
        return {
            sort: (sortSpec) => {
                this.lastSort = sortSpec;
                return {
                    toArray: async () => this.sortedTopics,
                };
            },
        };
    }
}

function createDb(collection) {
    return {
        collection(name) {
            assert.equal(name, 'persistenceTopics');
            return collection;
        },
    };
}

async function run() {
    const collection = new FakePersistenceCollection();
    const db = createDb(collection);

    collection.findOneAndUpdateQueue.push({
        value: {
            _id: 'topic-1',
            courseId: 'BIOC-E2E-PERSISTENCE',
            topic: 'photosynthesis',
            studentIds: ['student-1'],
        },
        lastErrorObject: { updatedExisting: false },
    });

    const inserted = await PersistenceTopic.incrementStudentCount(
        db,
        'BIOC-E2E-PERSISTENCE',
        '  Photosynthesis  ',
        'student-1'
    );

    assert.deepEqual(inserted, {
        success: true,
        topic: 'photosynthesis',
        count: 1,
        isNew: true,
    });
    assert.equal(collection.lastFindOneAndUpdate.filter.courseId, 'BIOC-E2E-PERSISTENCE');
    assert.equal(collection.lastFindOneAndUpdate.filter.topic.$regex.source, '^photosynthesis$');
    assert.equal(collection.lastFindOneAndUpdate.filter.topic.$regex.flags, 'i');
    assert.deepEqual(collection.lastFindOneAndUpdate.update.$addToSet, { studentIds: 'student-1' });
    assert.equal(collection.lastFindOneAndUpdate.update.$setOnInsert.topic, 'photosynthesis');
    assert.equal(collection.lastFindOneAndUpdate.options.upsert, true);
    assert.equal(collection.lastFindOneAndUpdate.options.returnDocument, 'after');
    assert.equal(collection.lastFindOneAndUpdate.options.includeResultMetadata, true);
    assert.deepEqual(collection.updateOneCalls[collection.updateOneCalls.length - 1], {
        filter: { _id: 'topic-1' },
        update: { $set: { studentCount: 1 } },
    });

    collection.findOneAndUpdateQueue.push({
        value: {
            _id: 'topic-2',
            courseId: 'BIOC-E2E-PERSISTENCE',
            topic: 'glycolysis',
        },
    });

    const missingStudentsArray = await PersistenceTopic.incrementStudentCount(
        db,
        'BIOC-E2E-PERSISTENCE',
        'Glycolysis',
        'student-2'
    );

    assert.deepEqual(missingStudentsArray, {
        success: true,
        topic: 'glycolysis',
        count: 0,
        isNew: false,
    });
    assert.deepEqual(collection.updateOneCalls[collection.updateOneCalls.length - 1], {
        filter: { _id: 'topic-2' },
        update: { $set: { studentCount: 0 } },
    });

    collection.findOneAndUpdateQueue.push({ value: null });

    const failedUpdate = await PersistenceTopic.incrementStudentCount(
        db,
        'BIOC-E2E-PERSISTENCE',
        'No Result',
        'student-3'
    );

    assert.deepEqual(failedUpdate, { success: false });

    collection.sortedTopics = [
        { topic: 'photosynthesis', studentCount: 3 },
        { topic: 'glycolysis', studentCount: 1 },
    ];

    const topics = await PersistenceTopic.getPersistenceTopics(db, 'BIOC-E2E-PERSISTENCE');
    assert.deepEqual(collection.findCalls[collection.findCalls.length - 1], { courseId: 'BIOC-E2E-PERSISTENCE' });
    assert.deepEqual(collection.lastSort, { studentCount: -1 });
    assert.deepEqual(topics, collection.sortedTopics);
}

run()
    .then(() => {
        try { v8.takeCoverage(); } catch { /* coverage disabled */ }
    })
    .catch((error) => {
        console.error(error);
        try { v8.takeCoverage(); } catch { /* coverage disabled */ }
        process.exitCode = 1;
    });
