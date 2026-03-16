// @ts-check
require('dotenv').config();
const { test, expect } = require('@playwright/test');
const {
  getCourseDetails,
  getCurrentUser,
  getPrimaryInstructorCourse,
  loginViaApi,
} = require('./helpers/e2e');

/**
 * Course management API tests for unit lifecycle and content/vector ingestion.
 * Expects the app to be running on localhost:8085 (npm run dev).
 */

async function getInstructorCourseContext(request) {
  await loginViaApi(request, 'instructor');

  const user = await getCurrentUser(request);
  const primaryCourse = await getPrimaryInstructorCourse(request);

  if (!primaryCourse) {
    return null;
  }

  const courseId = primaryCourse.id || primaryCourse.courseId;
  const course = await getCourseDetails(request, courseId);

  return {
    instructorId: user.userId,
    courseId,
    course,
  };
}

async function createUnit(request, courseId, instructorId) {
  const response = await request.post(`/api/courses/${encodeURIComponent(courseId)}/units`, {
    data: { instructorId },
  });
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBeTruthy();

  return body.data.unit.name;
}

async function renameUnit(request, courseId, unitName, displayName, instructorId) {
  const response = await request.put(
    `/api/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(unitName)}/rename`,
    {
      data: { displayName, instructorId },
    }
  );
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBeTruthy();

  return body;
}

async function deleteUnit(request, courseId, unitName, instructorId) {
  const response = await request.delete(
    `/api/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(unitName)}`,
    {
      data: { instructorId },
    }
  );
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBeTruthy();

  return body;
}

async function safeDeleteUnit(request, courseId, unitName, instructorId) {
  try {
    await request.delete(
      `/api/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(unitName)}`,
      {
        data: { instructorId },
      }
    );
  } catch (error) {
    // Best-effort cleanup only.
  }
}

async function deleteDocument(request, documentId, instructorId) {
  const response = await request.delete(`/api/documents/${encodeURIComponent(documentId)}`, {
    data: { instructorId },
  });
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBeTruthy();

  return body;
}

async function safeDeleteDocument(request, documentId, instructorId) {
  try {
    await request.delete(`/api/documents/${encodeURIComponent(documentId)}`, {
      data: { instructorId },
    });
  } catch (error) {
    // Best-effort cleanup only.
  }
}

async function uploadTextDocument(request, courseId, lectureName, instructorId, marker) {
  const response = await request.post('/api/documents/text', {
    data: {
      courseId,
      lectureName,
      documentType: 'lecture-notes',
      instructorId,
      title: `E2E Content ${marker}`,
      description: 'Temporary E2E text content upload',
      content: `Biochemistry course management verification content for ${marker}. This unit discusses phosphofructokinase regulation and citrate inhibition. Unique marker: ${marker}.`,
    },
    timeout: 60000,
  });
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBeTruthy();

  return body;
}

async function searchVectors(request, marker, courseId, lectureName) {
  const response = await request.post('/api/qdrant/search', {
    data: {
      query: `phosphofructokinase regulation ${marker}`,
      courseId,
      lectureName,
      limit: 5,
    },
    timeout: 60000,
  });
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBeTruthy();

  return body.data.results || [];
}

test.describe.serial('Course unit management', () => {
  test('instructor can add a new unit to a course', async ({ request }) => {
    const context = await getInstructorCourseContext(request);
    test.skip(!context, 'Need an instructor-owned course for unit tests.');

    const initialUnitCount = (context.course.lectures || []).length;
    let unitName = null;

    try {
      unitName = await createUnit(request, context.courseId, context.instructorId);

      const updatedCourse = await getCourseDetails(request, context.courseId);
      const newUnit = (updatedCourse.lectures || []).find((lecture) => lecture.name === unitName);

      expect(updatedCourse.lectures.length).toBe(initialUnitCount + 1);
      expect(newUnit).toBeDefined();
      expect(newUnit.isPublished).toBe(false);
      expect(Array.isArray(newUnit.documents)).toBeTruthy();
      expect(Array.isArray(newUnit.assessmentQuestions)).toBeTruthy();
    } finally {
      if (unitName) {
        await safeDeleteUnit(request, context.courseId, unitName, context.instructorId);
      }
    }
  });

  test('instructor can rename a unit display name and clear it again', async ({ request }) => {
    const context = await getInstructorCourseContext(request);
    test.skip(!context, 'Need an instructor-owned course for unit rename tests.');

    const displayName = `E2E Renamed Unit ${Date.now()}`;
    let unitName = null;

    try {
      unitName = await createUnit(request, context.courseId, context.instructorId);

      const renameBody = await renameUnit(request, context.courseId, unitName, displayName, context.instructorId);
      expect(renameBody.data.displayName).toBe(displayName);

      let updatedCourse = await getCourseDetails(request, context.courseId);
      let renamedUnit = (updatedCourse.lectures || []).find((lecture) => lecture.name === unitName);
      expect(renamedUnit.displayName).toBe(displayName);

      const clearBody = await renameUnit(request, context.courseId, unitName, '', context.instructorId);
      expect(clearBody.data.displayName).toBeNull();

      updatedCourse = await getCourseDetails(request, context.courseId);
      renamedUnit = (updatedCourse.lectures || []).find((lecture) => lecture.name === unitName);
      expect(renamedUnit.displayName || null).toBeNull();
    } finally {
      if (unitName) {
        await safeDeleteUnit(request, context.courseId, unitName, context.instructorId);
      }
    }
  });

  test('deleting a unit removes it from the course structure', async ({ request }) => {
    const context = await getInstructorCourseContext(request);
    test.skip(!context, 'Need an instructor-owned course for unit delete tests.');

    const unitName = await createUnit(request, context.courseId, context.instructorId);
    const deleteBody = await deleteUnit(request, context.courseId, unitName, context.instructorId);

    expect(deleteBody.data.deletedUnit).toBe(unitName);

    const updatedCourse = await getCourseDetails(request, context.courseId);
    const deletedUnit = (updatedCourse.lectures || []).find((lecture) => lecture.name === unitName);

    expect(deletedUnit).toBeUndefined();
  });
});

test.describe.serial('Course content and vector indexing', () => {
  test('uploading text content links it to the unit and indexes it in qdrant', async ({ request }) => {
    const context = await getInstructorCourseContext(request);
    test.skip(!context, 'Need an instructor-owned course for content upload tests.');

    const marker = `E2E_VECTOR_${Date.now()}`;
    let unitName = null;
    let documentId = null;

    try {
      unitName = await createUnit(request, context.courseId, context.instructorId);

      const uploadBody = await uploadTextDocument(request, context.courseId, unitName, context.instructorId, marker);
      documentId = uploadBody.data.documentId;

      expect(uploadBody.data.qdrantProcessed).toBe(true);
      expect(uploadBody.data.chunksStored).toBeGreaterThan(0);

      const documentResponse = await request.get(`/api/documents/${encodeURIComponent(documentId)}`);
      expect(documentResponse.ok()).toBeTruthy();
      const documentBody = await documentResponse.json();

      expect(documentBody.success).toBeTruthy();
      expect(documentBody.data.lectureName).toBe(unitName);
      expect(documentBody.data.content).toContain(marker);

      const lectureResponse = await request.get(
        `/api/documents/lecture?courseId=${encodeURIComponent(context.courseId)}&lectureName=${encodeURIComponent(unitName)}`
      );
      expect(lectureResponse.ok()).toBeTruthy();
      const lectureBody = await lectureResponse.json();

      expect(lectureBody.success).toBeTruthy();
      expect(lectureBody.data.documents.some((doc) => doc.documentId === documentId)).toBe(true);

      const results = await searchVectors(request, marker, context.courseId, unitName);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((result) => result.documentId === documentId)).toBe(true);
      expect(results.some((result) => String(result.chunkText).includes(marker))).toBe(true);
    } finally {
      if (documentId) {
        await safeDeleteDocument(request, documentId, context.instructorId);
      }
      if (unitName) {
        await safeDeleteUnit(request, context.courseId, unitName, context.instructorId);
      }
    }
  });

  test('deleting a unit removes its uploaded documents and qdrant vectors', async ({ request }) => {
    const context = await getInstructorCourseContext(request);
    test.skip(!context, 'Need an instructor-owned course for content cleanup tests.');

    const marker = `E2E_DELETE_VECTOR_${Date.now()}`;
    let unitName = null;
    let documentId = null;
    let unitDeleted = false;

    try {
      unitName = await createUnit(request, context.courseId, context.instructorId);

      const uploadBody = await uploadTextDocument(request, context.courseId, unitName, context.instructorId, marker);
      documentId = uploadBody.data.documentId;

      const initialResults = await searchVectors(request, marker, context.courseId, unitName);
      expect(initialResults.some((result) => result.documentId === documentId)).toBe(true);

      const deleteBody = await deleteUnit(request, context.courseId, unitName, context.instructorId);
      unitDeleted = true;

      expect(deleteBody.data.deletedUnit).toBe(unitName);
      expect(deleteBody.data.deletedDocumentsCount).toBeGreaterThanOrEqual(1);

      const updatedCourse = await getCourseDetails(request, context.courseId);
      expect((updatedCourse.lectures || []).some((lecture) => lecture.name === unitName)).toBe(false);

      const lectureResponse = await request.get(
        `/api/documents/lecture?courseId=${encodeURIComponent(context.courseId)}&lectureName=${encodeURIComponent(unitName)}`
      );
      expect(lectureResponse.ok()).toBeTruthy();
      const lectureBody = await lectureResponse.json();
      expect(lectureBody.success).toBeTruthy();
      expect(lectureBody.data.count).toBe(0);

      const documentResponse = await request.get(`/api/documents/${encodeURIComponent(documentId)}`);
      expect(documentResponse.status()).toBe(404);

      const remainingResults = await searchVectors(request, marker, context.courseId, unitName);
      expect(remainingResults.some((result) => result.documentId === documentId)).toBe(false);
    } finally {
      if (!unitDeleted && documentId) {
        await safeDeleteDocument(request, documentId, context.instructorId);
      }
      if (!unitDeleted && unitName) {
        await safeDeleteUnit(request, context.courseId, unitName, context.instructorId);
      }
    }
  });
});
