/**
 * EventBus
 * 
 * A centralized publish/subscribe event bus that decouples components.
 * Capabilities and Services emit events here, which are then consumed
 * by the StateEngine, UI Synchronizer, History Service, etc.
 */

class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} eventName 
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);

        // Return unsubscribe function
        return () => {
            const arr = this.listeners.get(eventName);
            if (arr) {
                this.listeners.set(eventName, arr.filter(cb => cb !== callback));
            }
        };
    }

    /**
     * Subscribe to an event, but only execute once
     * @param {string} eventName 
     * @param {Function} callback 
     */
    once(eventName, callback) {
        const unsubscribe = this.on(eventName, (...args) => {
            unsubscribe();
            callback(...args);
        });
    }

    /**
     * Emit an event to all subscribers
     * @param {string} eventName 
     * @param {any} payload 
     */
    emit(eventName, payload) {
        const arr = this.listeners.get(eventName);
        if (arr) {
            // Using setTimeout to ensure asynchronous execution and prevent blocking
            arr.forEach(callback => {
                setTimeout(() => {
                    try {
                        callback(payload);
                    } catch (error) {
                        console.error(`[EventBus] Error in listener for event '${eventName}':`, error);
                    }
                }, 0);
            });
        }
    }

    /**
     * Clear all listeners
     */
    clear() {
        this.listeners.clear();
    }
}

// Export as a singleton
module.exports = new EventBus();
