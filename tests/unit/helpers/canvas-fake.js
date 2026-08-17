/**
 * A fake Canvas `ApiClient` backed by multi-course fixtures.
 *
 * Deliberately at the HTTP-shape layer rather than the toolkit-function layer,
 * so these tests run the real `@ubc/ubc-genai-toolkit-lms-integration` matching,
 * resolving, and refusal logic. Stubbing `matchCourseRoster` itself would prove
 * only that BiocBot calls a function named after the behaviour it wants.
 *
 * Because the fixture holds several courses, a test can assert not just that the
 * right course was read but that the wrong one never was — `client.requests`
 * records every path touched.
 */

class FakeCanvasApiError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = 'CanvasApiError';
        this.statusCode = statusCode;
    }
}

/**
 * @param {Object} world - `{ courses: { [canvasCourseId]: { users, assignments, submissions } }, files }`
 * @returns {Object} A client implementing the ApiClient surface the toolkit uses
 */
function fakeCanvasClient(world) {
    const courses = world.courses || {};
    const files = world.files || {};
    const requests = [];
    const posted = [];
    // Progress states are consumed in order, so a test can queue
    // queued -> running -> completed, or a single `failed`.
    const progressQueue = [...(world.progress || [{ id: 'prog-1', workflow_state: 'completed', completion: 100 }])];

    function course(courseId) {
        const found = courses[String(courseId)];
        if (!found) throw new FakeCanvasApiError(`No such Canvas course ${courseId}`, 404);
        return found;
    }

    function assignment(courseId, assignmentId) {
        const found = (course(courseId).assignments || [])
            .find((item) => String(item.id) === String(assignmentId));
        if (!found) {
            throw new FakeCanvasApiError(`No such assignment ${assignmentId} in course ${courseId}`, 404);
        }
        return found;
    }

    async function getAll(path) {
        requests.push({ method: 'GET_ALL', path });

        let match = path.match(/^\/courses\/([^/]+)\/users$/);
        if (match) return course(match[1]).users || [];

        match = path.match(/^\/courses\/([^/]+)\/assignments$/);
        if (match) return course(match[1]).assignments || [];

        match = path.match(/^\/courses\/([^/]+)\/assignments\/([^/]+)\/submissions$/);
        if (match) {
            assignment(match[1], match[2]);
            return (course(match[1]).submissions || {})[String(match[2])] || [];
        }

        match = path.match(/^\/courses\/([^/]+)\/enrollments$/);
        if (match) return course(match[1]).enrollments || [];

        throw new FakeCanvasApiError(`Unrouted getAll ${path}`, 404);
    }

    async function get(path) {
        requests.push({ method: 'GET', path });

        let match = path.match(/^\/courses\/([^/]+)\/assignments\/([^/]+)\/submissions\/([^/]+)$/);
        if (match) {
            assignment(match[1], match[2]);
            const submission = ((course(match[1]).submissions || {})[String(match[2])] || [])
                .find((item) => String(item.user_id) === String(match[3]));
            if (!submission) {
                throw new FakeCanvasApiError(`No submission for user ${match[3]}`, 404);
            }
            return submission;
        }

        match = path.match(/^\/courses\/([^/]+)\/assignments\/([^/]+)$/);
        if (match) return assignment(match[1], match[2]);

        match = path.match(/^\/progress\/(.+)$/);
        if (match) {
            return progressQueue.length > 1 ? progressQueue.shift() : progressQueue[0];
        }

        throw new FakeCanvasApiError(`Unrouted get ${path}`, 404);
    }

    async function post(path, body) {
        requests.push({ method: 'POST', path });
        const match = path.match(/^\/courses\/([^/]+)\/assignments\/([^/]+)\/submissions\/update_grades$/);
        if (match) {
            assignment(match[1], match[2]);
            posted.push({ courseId: match[1], assignmentId: match[2], gradeData: body.grade_data });
            return progressQueue[0];
        }
        throw new FakeCanvasApiError(`Unrouted post ${path}`, 404);
    }

    async function download(url, options = {}) {
        requests.push({ method: 'DOWNLOAD', path: url });
        const file = files[url];
        if (!file) throw new FakeCanvasApiError(`No such file ${url}`, 404);
        // Mirrors the real client, which refuses rather than truncating.
        if (options.maxBytes !== undefined && file.data.length > options.maxBytes) {
            throw new FakeCanvasApiError(
                `Download exceeds maxBytes (${file.data.length} > ${options.maxBytes})`,
                413
            );
        }
        return {
            data: file.data,
            size: file.data.length,
            contentType: file.contentType,
            filename: file.filename
        };
    }

    return {
        get,
        getAll,
        post,
        put: async () => { throw new FakeCanvasApiError('put not supported', 405); },
        delete: async () => { throw new FakeCanvasApiError('delete not supported', 405); },
        download,
        requests,
        posted,
        /** Paths that mention a given Canvas course id — used to prove isolation. */
        pathsTouching(courseId) {
            return requests
                .map((entry) => entry.path)
                .filter((path) => path.includes(`/courses/${courseId}/`) || path.endsWith(`/courses/${courseId}`));
        }
    };
}

/** Builds a Canvas roster user. `integration_id` is the PUID at UBC. */
function rosterUser({ id, name, integrationId, sisId, loginId, email }) {
    return {
        id,
        name,
        sortable_name: name,
        email: email ?? null,
        login_id: loginId ?? null,
        sis_user_id: sisId ?? null,
        integration_id: integrationId ?? null
    };
}

function assignmentFixture({
    id,
    name = 'Lab 1',
    pointsPossible = 10,
    gradingType = 'points',
    postManually = false,
    anonymous = false,
    moderated = false
}) {
    return {
        id,
        name,
        points_possible: pointsPossible,
        grading_type: gradingType,
        post_manually: postManually,
        anonymous_grading: anonymous,
        moderated_grading: moderated
    };
}

function submissionFixture({
    userId,
    assignmentId,
    workflowState = 'submitted',
    score = null,
    grade = null,
    submittedAt = '2026-03-01T10:00:00Z',
    gradedAt = null,
    attempt = 1,
    late = false,
    missing = false,
    attachments = []
}) {
    return {
        user_id: userId,
        assignment_id: assignmentId,
        workflow_state: workflowState,
        score,
        grade,
        submitted_at: submittedAt,
        graded_at: gradedAt,
        attempt,
        late,
        missing,
        attachments
    };
}

module.exports = {
    FakeCanvasApiError,
    assignmentFixture,
    fakeCanvasClient,
    rosterUser,
    submissionFixture
};
