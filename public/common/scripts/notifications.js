(function () {
    const DEFAULT_TYPE = 'info';
    const VALID_TYPES = new Set(['success', 'error', 'warning', 'info']);

    function normalizeType(type) {
        return VALID_TYPES.has(type) ? type : DEFAULT_TYPE;
    }

    function ensureNotificationContainer() {
        // Open modals (public/common/scripts/modal-a11y.js) run through a native
        // <dialog>.showModal(), which renders in the browser's top layer - a
        // layer that paints above every normal element regardless of z-index,
        // by spec. A toast left in <body> is therefore stuck underneath an open
        // modal no matter how high its z-index goes. Parenting the container
        // inside the active dialog instead puts it in that same top layer, so
        // it stays fully visible without the user needing to close the modal.
        const activeDialog = document.querySelector('dialog[open]');
        const parent = activeDialog || document.body;

        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            parent.appendChild(container);
        } else if (container.parentElement !== parent) {
            parent.appendChild(container);
        }
        // Announce notifications to assistive technology without stealing focus.
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        return container;
    }

    function showNotification(message, type = DEFAULT_TYPE) {
        const normalizedType = normalizeType(type);
        const container = ensureNotificationContainer();
        const notification = document.createElement('div');
        notification.className = `notification ${normalizedType} notification-${normalizedType}`;

        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;

        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Dismiss notification');
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', () => notification.remove());

        notification.appendChild(messageSpan);
        notification.appendChild(closeButton);
        container.appendChild(notification);

        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);

        return notification;
    }

    window.showNotification = showNotification;
})();
