const { EventEmitter } = require('events');
const { BrowserWindow } = require('electron'); // For fetching actual states if needed, though event-driven is preferred

class StateManager extends EventEmitter {
  constructor() {
    super();
    this.state = {
      windows: {
        ai: false,
        calendar: false,
        tasks: false,
        history: false,
        report: false,
        edit: false,
        carryover: false
      },
      focusedWindow: null,
      selectedTask: null,
      currentPage: 'home',
      currentFilter: 'all',
      voiceMode: 'IDLE', // IDLE, LISTENING, THINKING, EXECUTING, SPEAKING, PENDING_CONFIRMATION
      settings: {
        theme: 'dark',
        voiceEnabled: true,
        closingTime: '17:00'
      }
    };
  }

  // Event Driven updates
  updateState(keyPath, value) {
    const keys = keyPath.split('.');
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    
    // Emit event that state changed
    this.emit('stateUpdated', { keyPath, value, state: this.state });
  }

  getState() {
    return this.state;
  }

  getVoiceMode() {
    return this.state.voiceMode;
  }

  setVoiceMode(mode) {
    this.updateState('voiceMode', mode);
  }

  setWindowOpen(windowName, isOpen) {
    this.updateState(`windows.${windowName}`, isOpen);
  }

  isWindowOpen(windowName) {
    return !!this.state.windows[windowName];
  }
}

module.exports = new StateManager(); // Singleton
