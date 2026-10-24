(function () {
    const DEFAULT_TYPE = 'info';
    const VALID_TYPES = new Set(['success', 'error', 'warning', 'info']);

    function normalizeType(type) {
        return VALID_TYPES.has(type) ? type : DEFAULT_TYPE;
    }

    function ensureNotificationContainer() {
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
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

    // Modal-scoped errors: a toast in the corner reads as part of the dimmed,
    // blurred backdrop behind an open modal, so it's easy to miss while the
    // user's focus is on the modal itself. These render an error banner
    // inside the modal instead, right where the user is already looking.
    function resolveModalElement(modalOrId) {
        return typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
    }

    function showModalError(modalOrId, message) {
        const modal = resolveModalElement(modalOrId);
        if (!modal) return;
        let banner = modal.querySelector('.modal-error-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'modal-error-banner';
            banner.setAttribute('role', 'alert');
            const body = modal.querySelector('.modal-body') || modal.querySelector('.modal-content') || modal;
            body.insertBefore(banner, body.firstChild);
        }
        banner.textContent = message;
        banner.hidden = false;
    }

    function clearModalError(modalOrId) {
        const modal = resolveModalElement(modalOrId);
        const banner = modal && modal.querySelector('.modal-error-banner');
        if (banner) banner.hidden = true;
    }

    window.showModalError = showModalError;
    window.clearModalError = clearModalError;
})();
