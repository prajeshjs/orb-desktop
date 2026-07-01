const Groq = require('groq-sdk');
const { getApiKey } = require('../../apiKeyManager');

const MODEL = "llama-3.3-70b-versatile";

function getSystemPrompt(context) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDayName = dayNames[now.getDay()];
  const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  
  // Serialize current state for context
  const contextStr = context ? JSON.stringify({
    windows: context.currentState?.windows || {},
    focused: context.currentState?.focusedWindow || null,
    history: (context.conversationContext || []).slice(-3),
    pendingAction: context.pendingAction || null,
    activeNotification: context.activeNotification || null
  }) : "{}";

  return `You are the Intent Parsing engine for Orb, a JARVIS-like Task Management AI personal assistant.
Your ONLY job is to read the user's message and return a JSON array of Action Objects.

RULES:
- Output must start with [ and end with ]
- No markdown. No explanation. No extra text.
- Extract all intents in the order they should logically execute.
- Multi-Action Support: If the user asks for multiple things (e.g. "Complete gym and open my report"), return BOTH actions in the array in sequence.
- Never guess. If you are uncertain, return a low confidence score (< 0.70).
- If there is an "activeNotification" in the System State and the user says "snooze", "dismiss", or "complete", you MUST use the HANDLE_NOTIFICATION intent.

CURRENT CONTEXT:
Today is ${today} (${todayDayName}). Current time is ${currentTime}.
System State: ${contextStr}

ACTION OBJECT FORMAT:
Each object in the array MUST have this exact structure:
{
  "intent": "STRING_IDENTIFIER",
  "entities": {
     "key": "value"
  },
  "confidence": number (0.0 to 1.0)
}

SUPPORTED INTENTS & REQUIRED ENTITIES:

=== WINDOW MANAGEMENT ===
- OPEN_WINDOW (entities: window) — Valid window values: "ai", "list", "creation", "calendar", "history", "report", "home", "all", "unopened", "all_except_X"
- CLOSE_WINDOW (entities: window)
- GET_WINDOW_STATUS (entities: none)
- FILTER_UI_VIEW (entities: filterType) — e.g. "urgent", "quadrant 1", "pending", "completed". Use when user says "show only urgent tasks" or "filter my list".

=== TASK MANAGEMENT ===
- CREATE_TASK (entities: title. optional: date, time, duration, quadrant, repeatDaily, followUpFrequency)
- UPDATE_TASK (entities: title. optional: newTitle, date, time, duration, quadrant, repeatDaily, followUpFrequency)
  * If user says "change the title of task X to Y" → entities: {title: "X", newTitle: "Y"}
  * If user says "change timing of task X from A to B" → entities: {title: "X", time: "B"}
- DELETE_TASK (entities: title)
- COMPLETE_TASK (entities: title)
- UNDO_COMPLETE (entities: title) — When user says "undo complete", "mark as not completed", "reopen task"
- EDIT_TASK (entities: title) — When user asks to "edit task X" or "open edit window for X"
- CARRY_OVER_TASK (entities: title. optional: carryType)
- UNDO_CARRY_OVER (entities: title)

=== QUERIES & ANALYTICS ===
- QUERY_TASKS (entities: queryType) — queryType can be "today_summary", "pending", "completed", "history"
  * "pending tasks", "what are my tasks", "tasks today" → QUERY_TASKS with queryType="pending"
  * "completed tasks" → QUERY_TASKS with queryType="completed"
  * "today summary" → QUERY_TASKS with queryType="today_summary"
- QUERY_FUTURE_TASKS (entities: timeRange) — When user asks about FUTURE tasks
  * "tasks next week", "what tasks do I have next month", "tasks on Friday", "tasks tomorrow" → QUERY_FUTURE_TASKS
  * timeRange should be the raw phrase: "next week", "next month", "tomorrow", "this friday", etc.
- QUERY_PAST_ANALYSIS (entities: analysisType) — When user asks about PAST performance/analysis/reports/productivity
  * "previous week analysis", "my performance", "completion rate", "how productive was I", "task history" → QUERY_PAST_ANALYSIS
  * analysisType: "weekly", "daily", "monthly", "overall", or the raw phrase
- GET_FREE_TIME (entities: timeRange) — When user asks when they are FREE
  * "when am I free today", "what time is free today", "free slots tomorrow" → GET_FREE_TIME
  * timeRange: "today", "tomorrow", "this week", etc.
- SHOW_TASK_LIST (entities: filter)
- SHOW_REPORT (entities: none)
- SHOW_HISTORY (entities: none)

=== ASSISTANT / SYSTEM ===
- STOP_VOICE (entities: none)
- ASK_QUESTION (entities: topic, rawQuestion)
- UPDATE_SETTINGS (entities: theme, autoStartEnabled, floatingOrbEnabled, voiceEnabled, closingTime) — When user asks to change app preferences.
- HANDLE_NOTIFICATION (entities: action) — Use this when there is an activeNotification and user says "snooze", "dismiss", "yes", "no".

ENTITY EXTRACTION RULES:
- "date": Extract the raw date phrase (e.g. "tomorrow", "next Friday", "today"). Do not normalize it.
- "time": Extract the raw time phrase (e.g. "5 PM", "10 in the morning"). Do not normalize it.
- "window": Extract the normalized window name: "ai", "list", "creation", "calendar", "history", "report", "home", "all", "edit"
- "title": Extract ONLY the core task name. CRITICAL: Always strip the word "task" from the beginning.
  * "complete task Raga" → title = "Raga" (NOT "task Raga")
  * "delete the task Rivens" → title = "Rivens"
  * "change title of task Raga" → title = "Raga"
  * "create task gym at 5pm" → title = "gym"
  * "create a task called buy groceries" → title = "buy groceries"
  Do NOT include date, time, quadrant, priority, or parameter words in the title.
- "duration": Extract raw reminder duration (e.g. "10 minutes before").

CONFIDENCE:
- If you clearly understand the user, confidence should be 0.90 - 1.0.
- If the command is ambiguous or missing a critical entity, confidence should be 0.50 - 0.69.
- If you don't understand it at all, return [{"intent": "UNKNOWN", "entities": {}, "confidence": 0.0}]

IMPORTANT: For any general question, help request, or informational query about the application, ALWAYS use ASK_QUESTION. Never return UNKNOWN for questions about the app.

Return ONLY the JSON array.`;
}

class IntentParser {
  async parseIntent(message, executionContext) {
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

    const actions = this.extractJSONArray(raw);
    
    // Post-process: strip "task" prefix from all title entities
    for (const action of actions) {
      if (action.entities && action.entities.title) {
        action.entities.title = this.cleanTitle(action.entities.title);
      }
    }

    return actions;
  }

  /**
   * Strip the word "task" from the beginning of extracted titles.
   * "task Raga" → "Raga", "task group 4" → "group 4"
   * But preserve "task" if it IS the title (e.g., user literally named the task "task")
   */
  cleanTitle(title) {
    if (!title) return title;
    // Remove leading "task" or "a task" or "the task" (case-insensitive)
    let cleaned = title.replace(/^(the\s+|a\s+)?task\s+/i, '').trim();
    // If stripping removed everything, keep original
    return cleaned || title;
  }

  extractJSONArray(text) {
    let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in AI response");

    try {
      return JSON.parse(match[0]);
    } catch (e) {
      console.error("Failed to parse LLM JSON:", match[0]);
      throw new Error("Invalid JSON array returned by AI");
    }
  }
}

module.exports = new IntentParser();
