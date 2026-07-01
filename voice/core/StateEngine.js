/**
 * StateEngine
 * 
 * Maintains the Application State Contract. Tracks current windows, filters, 
 * selected tasks, session context, and voice session details.
 * It listens to the EventBus to automatically update its state when capabilities execute.
 */

const EventBus = require('./EventBus');

class StateEngine {
    constructor() {
        this.state = {
            Windows: [], // list of currently open windows
            FocusedWindow: null, // the currently active window
            CurrentPage: null, // for pagination
            SelectedTask: null, // the task ID currently in focus
            SelectedDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
            Filters: {}, // active UI filters (e.g., status, quadrant)
            Reports: null, // currently loaded report criteria
            Settings: {}, // cached settings
            Theme: 'dark', // current theme
            PendingConfirmation: null, // action awaiting user confirmation
            PendingWorkflow: null, // active workflow sequence
            ConversationContext: [], // previous voice interactions
            VoiceSession: null, // active voice session details
            Timers: [] // active background timers/reminders
        };

        this._initializeEventSubscriptions();
    }

    _initializeEventSubscriptions() {
        EventBus.on('WindowOpened', (payload) => {
            if (!this.state.Windows.includes(payload.windowName)) {
                this.state.Windows.push(payload.windowName);
            }
            this.state.FocusedWindow = payload.windowName;
        });

        EventBus.on('WindowClosed', (payload) => {
            this.state.Windows = this.state.Windows.filter(w => w !== payload.windowName);
            if (this.state.FocusedWindow === payload.windowName) {
                this.state.FocusedWindow = this.state.Windows.length > 0 ? this.state.Windows[this.state.Windows.length - 1] : null;
            }
        });

        EventBus.on('TaskSelected', (payload) => {
            this.state.SelectedTask = payload.taskId;
        });

        EventBus.on('FiltersUpdated', (payload) => {
            this.state.Filters = { ...this.state.Filters, ...payload };
        });

        EventBus.on('SettingsUpdated', (payload) => {
            this.state.Settings = { ...this.state.Settings, ...payload };
        });
        
        EventBus.on('ContextUpdated', (payload) => {
            this.state.ConversationContext.push(payload);
            // keep last 10
            if (this.state.ConversationContext.length > 10) {
                this.state.ConversationContext.shift();
            }
        });
        
        EventBus.on('ConfirmationRequested', (payload) => {
            this.state.PendingConfirmation = payload;
        });
        
        EventBus.on('ConfirmationCleared', () => {
            this.state.PendingConfirmation = null;
        });
    }

    /**
     * Get the current state
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Set/update state manually (internal use)
     * @param {Object} partialState 
     */
    updateState(partialState) {
        this.state = { ...this.state, ...partialState };
    }
}

// Export as a singleton
module.exports = new StateEngine();
