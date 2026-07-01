const Groq = require('groq-sdk');
const fs = require('fs');
const { getApiKey } = require('../../apiKeyManager');

class SpeechRecognizer {
  
  async transcribeAudio(filePath) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API_KEY_MISSING");

    const groq = new Groq({ apiKey });

    try {
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-large-v3-turbo",
        prompt: "A task management command, like create task, complete task, open calendar, etc.",
        response_format: "json",
        language: "en", 
      });

      return transcription.text;
    } catch (err) {
      console.error("[SpeechRecognizer] Error:", err);
      throw err;
    }
  }
}

module.exports = new SpeechRecognizer();
