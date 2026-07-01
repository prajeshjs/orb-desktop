const { v4: uuidv4 } = require('crypto'); // We can use crypto.randomUUID() natively in node later, just a placeholder

class VoiceSessionManager {
  constructor() {
    this.sessionID = null;
    this.status = 'IDLE'; // IDLE, LISTENING, THINKING, EXECUTING, SPEAKING, CANCELLED, ERROR, TIMEOUT
    this.conversationHistory = [];
    this.pendingConfirmation = null;
    this.pendingQuestion = null;
  }

  startSession() {
    this.sessionID = require('crypto').randomUUID();
    this.setStatus('LISTENING');
    this.pendingConfirmation = null;
    this.pendingQuestion = null;
    return this.sessionID;
  }

  setStatus(status) {
    this.status = status;
    console.log(`[VoiceSession] Status changed to: ${status}`);
  }

  getStatus() {
    return this.status;
  }

  addInteraction(userText, assistantText) {
    this.conversationHistory.push({
      timestamp: Date.now(),
      user: userText,
      assistant: assistantText
    });
    
    // Keep only last 10 interactions to avoid bloated context
    if (this.conversationHistory.length > 10) {
      this.conversationHistory.shift();
    }
  }

  getHistory() {
    return this.conversationHistory;
  }

  setPendingConfirmation(actionPlan) {
    this.pendingConfirmation = actionPlan;
    this.setStatus('PENDING_CONFIRMATION');
  }

  clearPendingConfirmation() {
    this.pendingConfirmation = null;
    if (this.status === 'PENDING_CONFIRMATION') {
      this.setStatus('IDLE');
    }
  }

  endSession() {
    this.setStatus('IDLE');
    this.sessionID = null;
  }
  
  cancelSession() {
    this.setStatus('CANCELLED');
    this.sessionID = null;
    this.clearPendingConfirmation();
  }
}

module.exports = new VoiceSessionManager(); // Singleton
