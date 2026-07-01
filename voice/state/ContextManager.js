class ContextManager {
  constructor() {
    this.lastCreatedTask = null;
    this.lastSelectedTask = null;
    this.lastOpenedWindow = null;
    this.lastAIChatTopic = null;
    this.pendingClarification = null;
  }

  setLastCreatedTask(task) {
    this.lastCreatedTask = task;
  }

  setLastSelectedTask(task) {
    this.lastSelectedTask = task;
  }

  setLastOpenedWindow(windowName) {
    this.lastOpenedWindow = windowName;
  }

  setPendingClarification(action) {
    this.pendingClarification = action;
  }

  clearPendingClarification() {
    this.pendingClarification = null;
  }

  getContextSummary() {
    return {
      lastTask: this.lastSelectedTask || this.lastCreatedTask || null,
      activeWindow: this.lastOpenedWindow,
      topic: this.lastAIChatTopic,
      clarificationNeeded: !!this.pendingClarification
    };
  }
}

module.exports = new ContextManager();
