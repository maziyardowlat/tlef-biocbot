/**
 * Socket.IO Manager Service
 * Handles Socket.IO connections, rooms, and event emissions for real-time updates
 */

class SocketManager {
    /**
     * Initialize the Socket Manager
     * @param {SocketIO.Server} io - Socket.IO server instance
     */
    constructor(io) {
        this.io = io;
        this.setupConnectionHandler();
    }

    /**
     * Set up connection handler for new Socket.IO clients
     * Handles client connections, course room joining, and disconnections
     */
    setupConnectionHandler() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 Socket.IO client connected: ${socket.id}`);

            /**
             * Handle course room joining
             * Allows instructors to receive events only for their selected course
             */
            socket.on('join:course', (courseId) => {
                if (!courseId) {
                    console.warn('⚠️ Socket attempted to join course without courseId');
                    return;
                }
                socket.join(`course:${courseId}`);
                console.log(`📚 Socket ${socket.id} joined course room: ${courseId}`);
            });

            /**
             * Handle leaving a course room
             * Called when instructor changes courses
             */
            socket.on('leave:course', (courseId) => {
                if (!courseId) return;
                socket.leave(`course:${courseId}`);
                console.log(`📚 Socket ${socket.id} left course room: ${courseId}`);
            });

            /**
             * Handle disconnection
             */
            socket.on('disconnect', () => {
                console.log(`🔌 Socket.IO client disconnected: ${socket.id}`);
            });
        });
    }

    /**
     * Emit struggle state change event to course room
     * This event is triggered when a student activates/deactivates Directive Mode for a topic
     * @param {string} courseId - Course ID to emit to
     * @param {Object} data - Event data
     * @param {string} data.userId - Student user ID
     * @param {string} data.studentName - Student display name
     * @param {string} data.topic - Topic name (normalized lowercase)
     * @param {string} data.state - Current state ('Active' or 'Inactive')
     * @param {Date} data.timestamp - Timestamp of the state change
     * @param {string} data.courseId - Course ID (included in data for frontend filtering)
     */
    emitStruggleStateChange(courseId, data) {
        if (!courseId) {
            console.warn('⚠️ Cannot emit struggle state change: courseId is null');
            return;
        }

        // Emit to all sockets in the course room
        this.io.to(`course:${courseId}`).emit('struggle:stateChange', data);
        console.log(`📤 Emitted struggle:stateChange to course:${courseId}`, {
            student: data.studentName,
            topic: data.topic,
            state: data.state
        });
    }
}

module.exports = SocketManager;
