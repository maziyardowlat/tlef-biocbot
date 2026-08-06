const crypto = require('crypto');

const GRADE_TOTAL_KEY = '__course_total__';
const SUPPORTED_GRADE_PROVIDERS = Object.freeze(['canvas', 'moodle']);

function normalizeProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase();
    return SUPPORTED_GRADE_PROVIDERS.includes(normalized) ? normalized : null;
}

/**
 * Resolves which external course this BiocBot course reads grades from.
 *
 * An explicit grade source wins. Failing that it inherits the course linked for
 * file import, because in practice they are the same course and asking an
 * instructor to link the identical course twice is a step nobody would
 * understand. `inherited` tells the UI which of the two it got, so the Student
 * Hub can show where the link came from and let it be overridden.
 */
function getGradeSource(course, provider) {
    const normalized = normalizeProvider(provider);
    if (!normalized) return null;

    const configured = course?.lmsGradeSources?.[normalized];
    if (configured?.courseId) {
        return {
            provider: normalized,
            courseId: String(configured.courseId),
            name: configured.name || '',
            code: configured.code || '',
            lastImportedAt: configured.lastImportedAt || null,
            inherited: false
        };
    }

    // `lmsFileSources` is what both import wizards write. `lmsSync` is the
    // older Canvas-only field, still set alongside it for backward compatibility.
    const fileSource = course?.lmsFileSources?.[normalized]
        || (normalized === 'canvas' && course?.lmsSync?.provider === 'canvas' ? course.lmsSync : null);
    if (fileSource?.courseId) {
        return {
            provider: normalized,
            courseId: String(fileSource.courseId),
            name: fileSource.name || '',
            code: fileSource.code || '',
            lastImportedAt: null,
            inherited: true
        };
    }

    return null;
}

/** Pins this BiocBot course's grade source, overriding the inherited one. */
async function setGradeSource({ db, course, provider, externalCourse, linkedBy }) {
    const normalized = normalizeProvider(provider);
    if (!normalized) throw new Error('Unsupported LMS grade provider');

    const now = new Date();
    const source = {
        courseId: String(externalCourse.id),
        name: externalCourse.name || '',
        code: externalCourse.code || '',
        linkedAt: now,
        linkedBy: String(linkedBy)
    };
    await db.collection('courses').updateOne(
        { courseId: course.courseId },
        { $set: { [`lmsGradeSources.${normalized}`]: source, updatedAt: now } }
    );

    // Mappings and snapshots are scoped by external course id, so anything
    // pointing at the previous source is now stale and would show grades from
    // the wrong course alongside the new ones.
    const staleFilter = {
        courseId: course.courseId,
        provider: normalized,
        externalCourseId: { $ne: source.courseId }
    };
    await Promise.all([
        db.collection('lms_identity_mappings').deleteMany(staleFilter),
        db.collection('lms_grade_snapshots').deleteMany(staleFilter)
    ]);

    return { provider: normalized, ...source, inherited: false };
}

function listGradeSources(course, integration = {}) {
    return SUPPORTED_GRADE_PROVIDERS.map((provider) => {
        const source = getGradeSource(course, provider);
        return {
            provider,
            configured: Boolean(integration[provider]),
            linked: Boolean(source),
            ...(source || {})
        };
    });
}

async function readProviderGrades(api, client, provider, externalCourseId) {
    const gradeItems = await api.getGradeItems(client, externalCourseId);
    if (provider === 'canvas') {
        const [totals, ...itemGrades] = await Promise.all([
            api.getGrades(client, { courseId: externalCourseId }),
            ...gradeItems.map((item) => api.getGrades(client, {
                courseId: externalCourseId,
                gradeItemId: item.id
            }))
        ]);
        return { gradeItems, grades: [...totals, ...itemGrades.flat()] };
    }

    const grades = await api.getGrades(client, { courseId: externalCourseId });
    return { gradeItems, grades };
}

function createSnapshot({ courseId, provider, externalCourseId, importedBy, importedAt, batchId }, grade, mapping, gradeItemsById) {
    const gradeItemId = grade.gradeItemId ? String(grade.gradeItemId) : null;
    const gradeItem = gradeItemId ? gradeItemsById.get(gradeItemId) : null;
    return {
        courseId,
        provider,
        externalCourseId,
        externalUserId: String(grade.userId),
        localUserId: String(mapping.localUserId),
        gradeItemKey: gradeItemId || GRADE_TOTAL_KEY,
        gradeItemId,
        gradeItemName: gradeItem?.name || (gradeItemId ? `Grade item ${gradeItemId}` : 'Course total'),
        score: typeof grade.score === 'number' ? grade.score : null,
        grade: grade.grade || null,
        maxScore: typeof grade.maxScore === 'number'
            ? grade.maxScore
            : (typeof gradeItem?.maxScore === 'number' ? gradeItem.maxScore : null),
        submittedAt: grade.submittedAt ? new Date(grade.submittedAt) : null,
        gradedAt: grade.gradedAt ? new Date(grade.gradedAt) : null,
        importedAt,
        importedBy: String(importedBy),
        batchId
    };
}

async function importProviderGrades({ db, course, provider, api, client, importedBy }) {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) throw new Error('Unsupported LMS grade provider');

    const source = getGradeSource(course, normalizedProvider);
    if (!source) throw new Error(`This BiocBot course is not linked to ${normalizedProvider}`);

    const { gradeItems, grades } = await readProviderGrades(api, client, normalizedProvider, source.courseId);
    const mappings = await db.collection('lms_identity_mappings').find({
        courseId: course.courseId,
        provider: normalizedProvider,
        externalCourseId: source.courseId
    }).toArray();
    const mappingsByExternalId = new Map(mappings.map((mapping) => [String(mapping.externalUserId), mapping]));
    const gradeItemsById = new Map(gradeItems.map((item) => [String(item.id), item]));
    const importedAt = new Date();
    const batchId = crypto.randomUUID();
    const context = {
        courseId: course.courseId,
        provider: normalizedProvider,
        externalCourseId: source.courseId,
        importedBy,
        importedAt,
        batchId
    };

    const snapshots = grades.flatMap((grade) => {
        const mapping = mappingsByExternalId.get(String(grade.userId));
        return mapping ? [createSnapshot(context, grade, mapping, gradeItemsById)] : [];
    });

    if (snapshots.length) {
        await db.collection('lms_grade_snapshots').bulkWrite(
            snapshots.map((snapshot) => ({
                updateOne: {
                    filter: {
                        courseId: snapshot.courseId,
                        provider: snapshot.provider,
                        externalCourseId: snapshot.externalCourseId,
                        localUserId: snapshot.localUserId,
                        gradeItemKey: snapshot.gradeItemKey
                    },
                    update: { $set: snapshot },
                    upsert: true
                }
            }))
        );
    }

    await db.collection('lms_grade_snapshots').deleteMany({
        courseId: course.courseId,
        provider: normalizedProvider,
        externalCourseId: source.courseId,
        batchId: { $ne: batchId }
    });

    await db.collection('courses').updateOne(
        { courseId: course.courseId },
        {
            $set: {
                [`lmsGradeSources.${normalizedProvider}.lastImportedAt`]: importedAt,
                updatedAt: importedAt
            }
        }
    );

    return {
        provider: normalizedProvider,
        externalCourseId: source.courseId,
        importedAt,
        mappedStudents: new Set(snapshots.map((snapshot) => snapshot.localUserId)).size,
        importedGrades: snapshots.length,
        unmappedExternalUserIds: [...new Set(
            grades
                .map((grade) => String(grade.userId))
                .filter((externalUserId) => !mappingsByExternalId.has(externalUserId))
        )]
    };
}

function buildGradeView({ provider, source, mappings, snapshots, users }) {
    const usersById = new Map(users.map((user) => [String(user.userId), user]));
    const itemMap = new Map();
    for (const snapshot of snapshots) {
        if (snapshot.gradeItemKey === GRADE_TOTAL_KEY) continue;
        if (!itemMap.has(snapshot.gradeItemKey)) {
            itemMap.set(snapshot.gradeItemKey, {
                id: snapshot.gradeItemId,
                key: snapshot.gradeItemKey,
                name: snapshot.gradeItemName,
                maxScore: snapshot.maxScore
            });
        }
    }

    const gradeItems = [...itemMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    const snapshotsByLocalUser = new Map();
    for (const snapshot of snapshots) {
        if (!snapshotsByLocalUser.has(String(snapshot.localUserId))) {
            snapshotsByLocalUser.set(String(snapshot.localUserId), new Map());
        }
        snapshotsByLocalUser.get(String(snapshot.localUserId)).set(snapshot.gradeItemKey, snapshot);
    }

    const students = mappings.map((mapping) => {
        const localUserId = String(mapping.localUserId);
        const user = usersById.get(localUserId) || {};
        const studentGrades = snapshotsByLocalUser.get(localUserId) || new Map();
        const toValue = (snapshot) => snapshot ? {
            score: snapshot.score,
            grade: snapshot.grade,
            maxScore: snapshot.maxScore
        } : null;

        return {
            localUserId,
            externalUserId: String(mapping.externalUserId),
            displayName: user.displayName || user.username || localUserId,
            username: user.username || '',
            // How this student was tied to their LMS identity, so the Student
            // Hub can show the evidence behind a grade rather than a bare score.
            externalLabel: mapping.externalLabel || '',
            externalEmail: mapping.externalEmail || '',
            matchedBy: mapping.matchedBy || '',
            total: toValue(studentGrades.get(GRADE_TOTAL_KEY)),
            grades: Object.fromEntries(gradeItems.map((item) => [item.key, toValue(studentGrades.get(item.key))]))
        };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));

    const importedAt = snapshots.reduce((latest, snapshot) => {
        const value = snapshot.importedAt ? new Date(snapshot.importedAt) : null;
        return value && (!latest || value > latest) ? value : latest;
    }, null);

    return {
        provider,
        source,
        importedAt,
        gradeItems,
        students
    };
}

async function getStoredGradeView({ db, course, provider }) {
    const normalizedProvider = normalizeProvider(provider);
    const source = getGradeSource(course, normalizedProvider);
    if (!source) {
        return { provider: normalizedProvider, source: null, importedAt: null, gradeItems: [], students: [] };
    }

    const [mappings, snapshots] = await Promise.all([
        db.collection('lms_identity_mappings').find({
            courseId: course.courseId,
            provider: normalizedProvider,
            externalCourseId: source.courseId
        }).toArray(),
        db.collection('lms_grade_snapshots').find({
            courseId: course.courseId,
            provider: normalizedProvider,
            externalCourseId: source.courseId
        }).toArray()
    ]);
    const localUserIds = [...new Set(mappings.map((mapping) => String(mapping.localUserId)))];
    const users = localUserIds.length
        ? await db.collection('users').find({ userId: { $in: localUserIds } })
            .project({ _id: 0, userId: 1, username: 1, displayName: 1 })
            .toArray()
        : [];

    return buildGradeView({
        provider: normalizedProvider,
        source,
        mappings,
        snapshots,
        users
    });
}

module.exports = {
    GRADE_TOTAL_KEY,
    SUPPORTED_GRADE_PROVIDERS,
    buildGradeView,
    getGradeSource,
    getStoredGradeView,
    importProviderGrades,
    listGradeSources,
    normalizeProvider,
    readProviderGrades,
    setGradeSource
};
