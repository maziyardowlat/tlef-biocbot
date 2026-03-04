/**
 * Quiz Practice Page Script
 * Handles loading questions, submitting answers, and tracking progress
 */

document.addEventListener('DOMContentLoaded', async () => {
    await waitForAuth();

    const courseId = getCurrentCourseId();
    if (!courseId) {
        showDisabled('No course selected. Please go to the Chat page and select a course first.');
        return;
    }

    // State
    let allQuestions = [];
    let filteredQuestions = [];
    let currentIndex = 0;
    let allowMaterials = false;
    let sessionCorrect = 0;
    let sessionTotal = 0;
    let answered = false;

    // DOM refs
    const loadingEl = document.getElementById('quiz-loading');
    const emptyEl = document.getElementById('quiz-empty');
    const disabledEl = document.getElementById('quiz-disabled');
    const questionCard = document.getElementById('question-card');
    const completeCard = document.getElementById('quiz-complete');
    const progressEl = document.getElementById('quiz-progress');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');

    const unitFilter = document.getElementById('unit-filter');
    const typeFilter = document.getElementById('type-filter');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const submitBtn = document.getElementById('submit-btn');
    const nextBtn = document.getElementById('next-btn');
    const restartBtn = document.getElementById('restart-btn');

    // Load quiz data
    try {
        const [questionsRes, historyRes] = await Promise.all([
            fetch(`/api/quiz/questions?courseId=${courseId}`),
            fetch(`/api/quiz/history?courseId=${courseId}`)
        ]);

        const questionsData = await questionsRes.json();
        const historyData = await historyRes.json();

        if (!questionsRes.ok || !questionsData.success) {
            if (questionsRes.status === 403) {
                showDisabled(questionsData.message || 'Quiz practice is not enabled for this course.');
                return;
            }
            throw new Error(questionsData.message || 'Failed to load questions');
        }

        allQuestions = questionsData.questions || [];
        allowMaterials = questionsData.allowLectureMaterialAccess;

        // Populate unit filter
        const units = questionsData.units || [];
        for (const unit of units) {
            const option = document.createElement('option');
            option.value = unit.name;
            option.textContent = unit.displayName || unit.name;
            unitFilter.appendChild(option);
        }

        // Load stats
        if (historyData.success && historyData.stats) {
            updateGlobalStats(historyData.stats);
        }

        loadingEl.style.display = 'none';

        if (allQuestions.length === 0) {
            emptyEl.style.display = '';
            return;
        }

        applyFilters();
    } catch (error) {
        console.error('Error loading quiz data:', error);
        loadingEl.style.display = 'none';
        showDisabled('Error loading quiz data. Please try again later.');
    }

    // Filter & shuffle
    unitFilter.addEventListener('change', applyFilters);
    typeFilter.addEventListener('change', applyFilters);
    shuffleBtn.addEventListener('click', () => {
        shuffleArray(filteredQuestions);
        currentIndex = 0;
        sessionCorrect = 0;
        sessionTotal = 0;
        displayQuestion();
    });

    submitBtn.addEventListener('click', submitAnswer);
    nextBtn.addEventListener('click', nextQuestion);
    restartBtn.addEventListener('click', () => {
        shuffleArray(filteredQuestions);
        currentIndex = 0;
        sessionCorrect = 0;
        sessionTotal = 0;
        completeCard.style.display = 'none';
        displayQuestion();
    });

    function applyFilters() {
        const unit = unitFilter.value;
        const type = typeFilter.value;

        filteredQuestions = allQuestions.filter(q => {
            if (unit !== 'all' && q.lectureName !== unit) return false;
            if (type !== 'all' && q.questionType !== type) return false;
            return true;
        });

        shuffleArray(filteredQuestions);
        currentIndex = 0;
        sessionCorrect = 0;
        sessionTotal = 0;

        if (filteredQuestions.length === 0) {
            questionCard.style.display = 'none';
            completeCard.style.display = 'none';
            progressEl.style.display = 'none';
            emptyEl.style.display = '';
        } else {
            emptyEl.style.display = 'none';
            displayQuestion();
        }
    }

    function displayQuestion() {
        if (currentIndex >= filteredQuestions.length) {
            showCompletion();
            return;
        }

        const q = filteredQuestions[currentIndex];
        answered = false;

        // Show card, hide others
        questionCard.style.display = '';
        completeCard.style.display = 'none';
        progressEl.style.display = '';

        // Progress
        progressText.textContent = `Question ${currentIndex + 1} of ${filteredQuestions.length}`;
        progressFill.style.width = `${((currentIndex) / filteredQuestions.length) * 100}%`;

        // Meta
        document.getElementById('question-unit').textContent = q.lectureName;

        const typeBadge = document.getElementById('question-type-badge');
        const typeLabels = { 'multiple-choice': 'Multiple Choice', 'true-false': 'True/False', 'short-answer': 'Short Answer' };
        typeBadge.textContent = typeLabels[q.questionType] || q.questionType;


        // Question text
        document.getElementById('question-text').textContent = q.question;

        // Hide all answer areas
        document.getElementById('mc-options').style.display = 'none';
        document.getElementById('tf-options').style.display = 'none';
        document.getElementById('sa-container').style.display = 'none';

        // Show appropriate answer area
        if (q.questionType === 'multiple-choice') {
            const mcContainer = document.getElementById('mc-options');
            mcContainer.innerHTML = '';
            mcContainer.style.display = '';

            const sortedKeys = Object.keys(q.options).sort();
            for (const key of sortedKeys) {
                const label = document.createElement('label');
                label.className = 'option-label';

                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'mc-answer';
                radio.value = key;

                const text = document.createElement('span');
                text.className = 'option-text';
                text.textContent = `${key}. ${q.options[key]}`;

                label.appendChild(radio);
                label.appendChild(text);
                mcContainer.appendChild(label);
            }
        } else if (q.questionType === 'true-false') {
            document.getElementById('tf-options').style.display = '';
            const radios = document.querySelectorAll('input[name="tf-answer"]');
            radios.forEach(r => { r.checked = false; });
            document.querySelectorAll('#tf-options .option-label').forEach(l => {
                l.className = 'option-label';
            });
        } else if (q.questionType === 'short-answer') {
            document.getElementById('sa-container').style.display = '';
            const saInput = document.getElementById('sa-input');
            saInput.value = '';
            saInput.disabled = false;
        }

        // Reset buttons & feedback
        submitBtn.style.display = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Answer';
        nextBtn.style.display = 'none';
        document.getElementById('feedback-container').style.display = 'none';
        document.getElementById('materials-container').style.display = 'none';
    }

    async function submitAnswer() {
        if (answered) return;

        const q = filteredQuestions[currentIndex];
        let studentAnswer = '';

        if (q.questionType === 'multiple-choice') {
            const selected = document.querySelector('input[name="mc-answer"]:checked');
            if (!selected) {
                showToast('Please select an answer.');
                return;
            }
            studentAnswer = selected.value;
        } else if (q.questionType === 'true-false') {
            const selected = document.querySelector('input[name="tf-answer"]:checked');
            if (!selected) {
                showToast('Please select True or False.');
                return;
            }
            studentAnswer = selected.value;
        } else if (q.questionType === 'short-answer') {
            studentAnswer = document.getElementById('sa-input').value.trim();
            if (!studentAnswer) {
                showToast('Please type your answer.');
                return;
            }
        }

        answered = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Checking...';

        let correct = false;
        let feedback = '';

        try {
            if (q.questionType === 'multiple-choice' || q.questionType === 'true-false') {
                // Client-side check
                correct = studentAnswer.toLowerCase() === q.correctAnswer.toLowerCase();
                feedback = correct ? 'Correct! Well done.' : `Incorrect. The correct answer is ${q.correctAnswer}.`;
                highlightOptions(q, studentAnswer);
            } else {
                // Short-answer: AI evaluation
                const displayName = (typeof currentUser !== 'undefined' && currentUser)
                    ? (currentUser.displayName || currentUser.username || 'Student')
                    : 'Student';

                const res = await fetch('/api/quiz/check-answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        courseId,
                        questionId: q.questionId,
                        lectureName: q.lectureName,
                        studentAnswer,
                        studentName: displayName
                    })
                });

                const data = await res.json();
                if (data.success && data.data) {
                    correct = data.data.correct;
                    feedback = data.data.feedback || (correct ? 'Correct!' : 'Incorrect.');
                } else {
                    feedback = 'Unable to evaluate answer. Please try again.';
                }

                document.getElementById('sa-input').disabled = true;
            }
        } catch (error) {
            console.error('Error checking answer:', error);
            feedback = 'Error checking answer. Please try again.';
        }

        // Show feedback
        showFeedback(correct, feedback);

        // Update session stats
        sessionTotal++;
        if (correct) sessionCorrect++;

        // Record attempt
        try {
            await fetch('/api/quiz/attempt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    questionId: q.questionId,
                    lectureName: q.lectureName,
                    questionType: q.questionType,
                    studentAnswer,
                    correct,
                    feedback
                })
            });
        } catch (e) {
            console.error('Error recording attempt:', e);
        }

        // Refresh global stats
        try {
            const histRes = await fetch(`/api/quiz/history?courseId=${courseId}`);
            const histData = await histRes.json();
            if (histData.success && histData.stats) {
                updateGlobalStats(histData.stats);
            }
        } catch (e) {
            console.error('Error refreshing stats:', e);
        }

        // Show materials if wrong and allowed
        if (!correct && allowMaterials) {
            loadMaterials(q.lectureName);
        }

        // Show next button
        submitBtn.style.display = 'none';
        nextBtn.style.display = '';
    }

    function nextQuestion() {
        currentIndex++;
        displayQuestion();
    }

    function highlightOptions(q, studentAnswer) {
        const containerSelector = q.questionType === 'multiple-choice' ? '#mc-options' : '#tf-options';
        const labels = document.querySelectorAll(`${containerSelector} .option-label`);

        labels.forEach(label => {
            const radio = label.querySelector('input[type="radio"]');
            label.classList.add('disabled');

            if (radio.value.toLowerCase() === q.correctAnswer.toLowerCase()) {
                label.classList.add(radio.value.toLowerCase() === studentAnswer.toLowerCase() ? 'correct' : 'was-correct');
            } else if (radio.value.toLowerCase() === studentAnswer.toLowerCase()) {
                label.classList.add('incorrect');
            }
        });
    }

    function showFeedback(correct, text) {
        const container = document.getElementById('feedback-container');
        const icon = document.getElementById('feedback-icon');
        const textEl = document.getElementById('feedback-text');

        container.className = 'feedback-container ' + (correct ? 'correct' : 'incorrect');
        icon.textContent = correct ? '\u2705' : '\u274C';
        textEl.textContent = text;
        container.style.display = '';
    }

    async function loadMaterials(lectureName) {
        try {
            const res = await fetch(`/api/quiz/materials?courseId=${courseId}&lectureName=${encodeURIComponent(lectureName)}`);
            const data = await res.json();

            if (!data.success || !data.materials || data.materials.length === 0) return;

            const container = document.getElementById('materials-container');
            const list = document.getElementById('materials-list');
            list.innerHTML = '';

            for (const mat of data.materials) {
                const item = document.createElement('div');
                item.className = 'material-item';
                item.onclick = () => downloadMaterial(mat.documentId, mat.originalName);

                const icon = document.createElement('span');
                icon.className = 'material-icon';
                icon.textContent = getFileIcon(mat.mimeType);

                const name = document.createElement('span');
                name.className = 'material-name';
                name.textContent = mat.originalName;

                const size = document.createElement('span');
                size.className = 'material-size';
                size.textContent = formatFileSize(mat.size);

                item.appendChild(icon);
                item.appendChild(name);
                item.appendChild(size);
                list.appendChild(item);
            }

            container.style.display = '';
        } catch (e) {
            console.error('Error loading materials:', e);
        }
    }

    async function downloadMaterial(documentId, filename) {
        try {
            const res = await fetch(`/api/quiz/materials/${documentId}/download?courseId=${courseId}`);
            const data = await res.json();

            if (data.success && data.data && data.data.content) {
                // Create a text blob and download
                const blob = new Blob([data.data.content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename || 'document.txt';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                showToast('Unable to download this document.');
            }
        } catch (e) {
            console.error('Error downloading material:', e);
            showToast('Error downloading material.');
        }
    }

    function showCompletion() {
        questionCard.style.display = 'none';
        progressEl.style.display = 'none';
        completeCard.style.display = '';

        document.getElementById('completion-correct').textContent = sessionCorrect;
        document.getElementById('completion-total').textContent = sessionTotal;

        progressFill.style.width = '100%';
    }

    function updateGlobalStats(stats) {
        document.getElementById('stat-total').textContent = stats.totalAttempts;
        document.getElementById('stat-correct').textContent = stats.correctCount;
        document.getElementById('stat-accuracy').textContent = stats.accuracy + '%';
    }

    function showDisabled(message) {
        const loadingEl = document.getElementById('quiz-loading');
        const disabledEl = document.getElementById('quiz-disabled');
        loadingEl.style.display = 'none';
        disabledEl.querySelector('p').textContent = message;
        disabledEl.style.display = '';
    }

    function showToast(message) {
        // Simple toast notification
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = 'notification info';
        notification.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => notification.remove());
        notification.appendChild(closeBtn);

        container.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }

    // Utility functions
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function getFileIcon(mimeType) {
        if (!mimeType) return '\uD83D\uDCC4';
        if (mimeType.includes('pdf')) return '\uD83D\uDCC4';
        if (mimeType.includes('word') || mimeType.includes('document')) return '\uD83D\uDCC3';
        if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '\uD83D\uDCCA';
        if (mimeType.includes('image')) return '\uD83D\uDDBC';
        return '\uD83D\uDCC4';
    }

    function formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
});

/**
 * Wait for auth to be ready
 */
async function waitForAuth() {
    return new Promise((resolve) => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            resolve();
            return;
        }
        document.addEventListener('auth:ready', () => resolve(), { once: true });
        // Fallback timeout
        setTimeout(resolve, 3000);
    });
}
