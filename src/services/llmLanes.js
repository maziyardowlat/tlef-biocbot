const LANES = Object.freeze({
    FRONTEND: 'frontend',
    BACKEND: 'backend'
});

const DEFAULT_LANE = LANES.FRONTEND;
const VALID_LANES = new Set(Object.values(LANES));

/**
 * Resolve a caller-supplied lane without allowing a bad value to break an LLM
 * request. Undefined is the backward-compatible default; an explicitly invalid
 * value also falls back, but is made visible so typos do not stay silent.
 */
function normalizeLane(value) {
    if (value === undefined || value === null || value === '') {
        return DEFAULT_LANE;
    }
    if (VALID_LANES.has(value)) {
        return value;
    }

    console.warn(`⚠️ Unknown LLM lane "${String(value)}"; using ${DEFAULT_LANE}`);
    return DEFAULT_LANE;
}

function laneLabel(lane) {
    return normalizeLane(lane) === LANES.BACKEND
        ? 'Back-end (processing)'
        : 'Front-end (student-facing)';
}

module.exports = {
    DEFAULT_LANE,
    LANES,
    laneLabel,
    normalizeLane
};
