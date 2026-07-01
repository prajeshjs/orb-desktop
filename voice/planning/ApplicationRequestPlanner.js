/**
 * ApplicationRequestPlanner
 * 
 * Replaces IntentParser. Maps Natural Language to an Application Request schema.
 * Defines request types (Command, Query, Workflow, Recommendation).
 */

const Groq = require('groq-sdk');
const { getApiKey } = require('../../apiKeyManager');
const CapabilityRegistry = require('../core/CapabilityRegistry');

const MODEL = "llama-3.3-70b-versatile";

function getSystemPrompt(context) {
  const manifests = CapabilityRegistry.getAllManifests().map(m => `- ${m.intent}: ${m.name}`).join('\n');
  
  return `You are the Application Request Planner for Orb AI Core.
Your job is to read the user's message and return a JSON object representing an Application Request.

RULES:
- Return ONLY valid JSON. No markdown. No explanations.
- Choose the correct type: Command, Query, Workflow, Recommendation, System.
- Map the user's intent strictly to one of the following Capabilities/Intents:
${manifests}

SCHEMA:
{
  "type": "Command|Query|Workflow|Recommendation",
  "intent": "STRING_IDENTIFIER",
  "parameters": {
     "key": "value"
  },
  "uiActions": ["OpenList", "FocusInput"],
  "confidence": 0.95
}

Extract parameters literally. Do not execute logic.
`;
}

class ApplicationRequestPlanner {
  async parse(message, executionContext) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API_KEY_MISSING");

    const groq = new Groq({ apiKey });

    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: getSystemPrompt(executionContext) },
        { role: "user", content: message }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Empty response from Groq");

    let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("Invalid JSON returned by Planner");
    }
  }
}

module.exports = new ApplicationRequestPlanner();
