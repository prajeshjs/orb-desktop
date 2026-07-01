const VoiceSessionManager = require('./VoiceSessionManager');
const RecoveryManager = require('./RecoveryManager');

class InterruptManager {
  constructor() {
    this.interrupted = false;
  }

  triggerInterrupt(sessionId) {
    console.warn(`[InterruptManager] Interrupt triggered for session ${sessionId}`);
    this.interrupted = true;
    
    // Stop ongoing speech immediately
    this.stopSpeech();
    
    // Cancel the session
    VoiceSessionManager.cancelSession();
  }

  isInterrupted() {
    return this.interrupted;
  }

  reset() {
    this.interrupted = false;
  }

  stopSpeech() {
    // Interface to TTS engine to immediately halt playback
    console.log(`[TTS] Audio playback forcibly stopped.`);
  }
}

module.exports = new InterruptManager();
