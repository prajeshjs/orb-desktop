const IntentParser = require('./IntentParser');
const EntityNormalizer = require('./EntityNormalizer');

class AIService {
  
  async processText(text, executionContext) {
    try {
      // 1. Parse Intents
      const rawActions = await IntentParser.parseIntent(text, executionContext);
      
      const processedActions = [];
      const clarificationNeeded = [];

      // 2. Process each action
      for (let i = 0; i < rawActions.length; i++) {
        let action = rawActions[i];
        
        // Ensure ID
        action.id = `action-${Date.now()}-${i}`;
        
        // 3. Confidence Check
        const conf = typeof action.confidence === 'number' ? action.confidence : 1.0;
        if (conf < 0.70) {
          clarificationNeeded.push(action);
          continue; // Skip executing low confidence actions
        }

        // 4. Normalize Entities
        action = EntityNormalizer.normalize(action);
        
        processedActions.push(action);
      }

      return {
        actions: processedActions,
        clarificationNeeded: clarificationNeeded
      };
      
    } catch (err) {
      console.error("[AIService] Error processing text:", err);
      throw err;
    }
  }

  async generateNarration(data, taskDescription) {
    try {
      const Groq = require('groq-sdk');
      const { getApiKey } = require('../../apiKeyManager');
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error("API_KEY_MISSING");

      const groq = new Groq({ apiKey });
      
      const formatTime = (isoString) => {
        if (!isoString) return isoString;
        try {
          const d = new Date(isoString);
          if (isNaN(d.getTime())) return isoString;
          return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        } catch(e) { return isoString; }
      };

      const formatDataForLLM = (obj) => {
        if (!obj) return obj;
        const clone = JSON.parse(JSON.stringify(obj));
        const traverse = (o) => {
          for (let k in o) {
            if (typeof o[k] === 'object' && o[k] !== null) {
              traverse(o[k]);
            } else if (typeof o[k] === 'string' && (k === 'dueAt' || k === 'remindAt' || k === 'timestamp' || k === 'completedAt')) {
              o[`${k}Local`] = formatTime(o[k]);
            }
          }
        };
        traverse(clone);
        return clone;
      };

      const formattedData = formatDataForLLM(data);

      const systemPrompt = `You are the narration engine for a voice assistant.
Your job is to read the provided raw JSON data and generate a natural, conversational, and concise spoken summary answering the user's query about their tasks.
- Keep it brief. 
- Use a friendly, professional tone.
- Do NOT use markdown (no asterisks, no hashes) as this text will be read aloud by TTS.
- Focus on answering the prompt specifically.
- CRITICAL: When mentioning times, ALWAYS use the 'Local' fields (like dueAtLocal) and state the time EXCLUSIVELY in 12-hour format with AM or PM (e.g., "10:00 PM"). Never use 24-hour time.`;

      const userPrompt = `Task Description: ${taskDescription}\nRaw JSON Data: ${JSON.stringify(formattedData)}`;

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      });

      return completion.choices?.[0]?.message?.content || "I've pulled the data, but I couldn't summarize it.";
    } catch (err) {
      console.error("[AIService] Error generating narration:", err);
      return "I encountered an error summarizing the data.";
    }
  }

}

module.exports = new AIService();
