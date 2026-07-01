const VoiceSessionManager = require('./VoiceSessionManager');
const CommandBus = require('./CommandBus');
const StateManager = require('../state/StateManager');
const AIService = require('../nlp/AIService');
const Planner = require('../planning/Planner');
const ActionValidator = require('../planning/ActionValidator');
const ResultCollector = require('../output/ResultCollector');
const ResponseSummarizer = require('../output/ResponseSummarizer');
const CapabilityRegistry = require('./CapabilityRegistry');
const ConfirmationManager = require('../state/ConfirmationManager');

// Register Capabilities — Window & Task
const { OpenWindowCapability, CloseWindowCapability, FilterUIViewCapability } = require('../capabilities/Window');
const { 
  CreateTaskCapability,
  DeleteTaskCapability,
  CompleteTaskCapability,
  EditTaskCapability,
  CarryOverTaskCapability,
  UndoCarryOverTaskCapability,
  UpdateTaskCapability,
  QueryTasksCapability
} = require('../capabilities/Task');

// Register Capabilities — Assistant
const {
  StopVoiceCapability,
  AskQuestionCapability,
  GetWindowStatusCapability,
  UndoCompleteCapability,
  UpdateSettingsCapability,
  HandleNotificationCapability
} = require('../capabilities/Assistant');

// Register Capabilities — Analytics
const {
  QueryFutureTasksCapability,
  QueryPastAnalysisCapability,
  GetFreeTimeCapability
} = require('../capabilities/Analytics');

// ── Quick-match patterns for STOP_VOICE (no LLM needed) ──
const STOP_PATTERNS = /^\s*(stop|cancel|bye|goodbye|shut\s*up|never\s*mind|nevermind|i'?m\s*done|that'?s\s*all|end\s*(conversation|session|voice)?|stop\s*(voice|listening|the\s*voice|agent)|close\s*(voice|the\s*voice)\s*(agent|assistant)?|quit)\s*[.!?]*\s*$/i;

// ── Quick-match for internet / connectivity errors ──
const CONNECTIVITY_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH'];

class VoiceController {
  constructor() {
    this.isInitialized = false;
    this.appAdapter = null;
  }

  init(appAdapter) {
    console.log('[VoiceController] Initializing Voice Pipeline...');
    this.appAdapter = appAdapter;
    
    // Pass app adapter to capabilities if needed
    OpenWindowCapability.appAdapter = appAdapter;
    CloseWindowCapability.appAdapter = appAdapter;
    FilterUIViewCapability.appAdapter = appAdapter;
    CreateTaskCapability.appAdapter = appAdapter;
    DeleteTaskCapability.appAdapter = appAdapter;
    CompleteTaskCapability.appAdapter = appAdapter;
    EditTaskCapability.appAdapter = appAdapter;
    CarryOverTaskCapability.appAdapter = appAdapter;
    UndoCarryOverTaskCapability.appAdapter = appAdapter;
    UpdateSettingsCapability.appAdapter = appAdapter;
    HandleNotificationCapability.appAdapter = appAdapter;

    // Register Window & Task capabilities
    CapabilityRegistry.register(OpenWindowCapability);
    CapabilityRegistry.register(CloseWindowCapability);
    CapabilityRegistry.register(FilterUIViewCapability);
    CapabilityRegistry.register(CreateTaskCapability);
    CapabilityRegistry.register(DeleteTaskCapability);
    CapabilityRegistry.register(CompleteTaskCapability);
    CapabilityRegistry.register(EditTaskCapability);
    CapabilityRegistry.register(CarryOverTaskCapability);
    CapabilityRegistry.register(UndoCarryOverTaskCapability);
    CapabilityRegistry.register(UpdateTaskCapability);
    CapabilityRegistry.register(QueryTasksCapability);

    // Register Assistant capabilities
    CapabilityRegistry.register(StopVoiceCapability);
    CapabilityRegistry.register(AskQuestionCapability);
    CapabilityRegistry.register(GetWindowStatusCapability);
    CapabilityRegistry.register(UndoCompleteCapability);
    CapabilityRegistry.register(UpdateSettingsCapability);
    CapabilityRegistry.register(HandleNotificationCapability);

    // Register Analytics capabilities
    CapabilityRegistry.register(QueryFutureTasksCapability);
    CapabilityRegistry.register(QueryPastAnalysisCapability);
    CapabilityRegistry.register(GetFreeTimeCapability);

    this.isInitialized = true;
  }

  async handleVoiceInput(transcript) {
    if (!this.isInitialized) throw new Error("VoiceController not initialized");
    
    const sessionId = VoiceSessionManager.startSession();
    VoiceSessionManager.addInteraction(transcript, null);
    
    console.log(`[VoiceController] Session ${sessionId} - Received transcript: ${transcript}`);

    try {
      // ── 0a. Quick STOP detection (no LLM needed) ──
      if (STOP_PATTERNS.test(transcript.trim())) {
        const responseText = 'Voice assistant stopped. Talk to you later!';
        if (this.appAdapter && this.appAdapter.stopVoice) {
          await this.appAdapter.stopVoice();
        }
        VoiceSessionManager.addInteraction(transcript, responseText);
        VoiceSessionManager.endSession();
        ConfirmationManager.clearPendingAction();
        return { success: true, message: responseText, stopped: true };
      }

      // ── 0b. Check for pending confirmations FIRST ──
      const pending = ConfirmationManager.getPendingAction();
      if (pending) {
         const lower = transcript.toLowerCase().trim();
         
         // Missing Fields / Clarification handling
         if (pending.needsClarification) {
            // Re-route back through the NLP specifically to fill the missing fields for the pending action
            ConfirmationManager.clearPendingAction();
            const executionContext = {
              currentState: StateManager.getState(),
              conversationContext: VoiceSessionManager.getHistory(),
              sessionId: sessionId,
              appAdapter: this.appAdapter,
              pendingAction: pending.action
            };
            
            var injectedPendingAction = pending.action;
         } else {
             // Basic YES/NO parsing — remove punctuation to ensure pure word matching
             const cleanLower = lower.replace(/[^\w\s]|_/g, "");
             const isYes = /\b(yes|y|yeah|yup|sure|confirm|do it|delete|okay|ok|go ahead|proceed)\b/i.test(cleanLower);
             const isNo = /\b(no|n|nope|cancel|stop|dont|do not|skip|forget it)\b/i.test(cleanLower);
             
             if (isYes) {
                ConfirmationManager.clearPendingAction();
                const result = await CommandBus.execute(pending.action, {
                  appAdapter: this.appAdapter,
                  forceExecution: true // bypass confirmation
                });
                const summary = ResponseSummarizer.summarize([result]);
                VoiceSessionManager.addInteraction(transcript, summary);
                VoiceSessionManager.endSession();
                return { success: result.status === 'SUCCESS', message: summary };
             } else if (isNo) {
                ConfirmationManager.clearPendingAction();
                const responseText = "Action cancelled.";
                VoiceSessionManager.addInteraction(transcript, responseText);
                VoiceSessionManager.endSession();
                return { success: true, message: responseText };
             }

             // Convert written numbers to digits
             const wordToNum = {
               'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
               'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
             };
             let numStr = cleanLower.split(/\s+/)[0];
             let parsedNum = parseInt(numStr, 10);
             if (isNaN(parsedNum) && wordToNum[numStr.toLowerCase()]) {
                 parsedNum = wordToNum[numStr.toLowerCase()];
             }

             // Disambiguation / Option Selection handling (numbers 1-10)
             if ((pending.needsDisambiguation || pending.needsOptionSelection) && !isNaN(parsedNum)) {
                const num = parsedNum;
                if (num >= 1 && num <= pending.options.length) {
                   // Update the action with the chosen option
                   const chosen = pending.options[num - 1];
                   if (chosen.key) {
                       pending.action.entities.optionKey = chosen.key;
                   }
                   if (chosen.title) {
                       pending.action.entities.title = chosen.title;
                   }
                   if (chosen.id) {
                       pending.action.entities.taskId = chosen.id;
                   }
                   ConfirmationManager.clearPendingAction();
                   const result = await CommandBus.execute(pending.action, {
                     appAdapter: this.appAdapter,
                     forceExecution: true
                   });
                   const summary = ResponseSummarizer.summarize([result]);
                   VoiceSessionManager.addInteraction(transcript, summary);
                   VoiceSessionManager.endSession();
                   return { success: result.status === 'SUCCESS', message: summary };
                }
             }

             // If we are waiting for a confirmation or selection and the user said something invalid,
             // do NOT fall through to NLP. Keep them in the confirmation loop.
             let errorPrompt = "Please reply with yes or no.";
             if (pending.needsDisambiguation || pending.needsOptionSelection) {
                errorPrompt = `Please reply with a number between 1 and ${pending.options.length}, or say cancel.`;
             }
             VoiceSessionManager.addInteraction(transcript, errorPrompt);
             VoiceSessionManager.endSession();
             return { success: false, message: errorPrompt, needsClarification: true };
         }
      }

      // Setup Execution Context
      const executionContext = {
        currentState: StateManager.getState(),
        conversationContext: VoiceSessionManager.getHistory(),
        sessionId: sessionId,
        appAdapter: this.appAdapter,
        pendingAction: typeof injectedPendingAction !== 'undefined' ? injectedPendingAction : null,
        activeNotification: this.appAdapter && this.appAdapter.getActiveNotification ? this.appAdapter.getActiveNotification() : null
      };

      // 1. LLM Understanding (Extract intents & normalize)
      const { actions, clarificationNeeded } = await AIService.processText(transcript, executionContext);
      
      if (clarificationNeeded.length > 0) {
        const responseText = "I'm not quite sure I understood that. Could you rephrase your request? You can ask me to manage tasks, open windows, check your schedule, or ask questions about the application.";
        VoiceSessionManager.addInteraction(transcript, responseText);
        VoiceSessionManager.endSession();
        return { message: responseText, needsClarification: true };
      }

      if (actions.length === 0) {
        const responseText = "I didn't catch any actionable commands from that. You can try commands like: create task, show pending tasks, open calendar, what are my shortcuts, or when am I free today.";
        VoiceSessionManager.addInteraction(transcript, responseText);
        VoiceSessionManager.endSession();
        return { message: responseText };
      }

      // ── Check for STOP_VOICE intent from LLM ──
      const stopAction = actions.find(a => a.intent === 'STOP_VOICE');
      if (stopAction) {
        const responseText = 'Voice assistant stopped. Talk to you later!';
        if (this.appAdapter && this.appAdapter.stopVoice) {
          await this.appAdapter.stopVoice();
        }
        VoiceSessionManager.addInteraction(transcript, responseText);
        VoiceSessionManager.endSession();
        ConfirmationManager.clearPendingAction();
        return { success: true, message: responseText, stopped: true };
      }

      // 2. Action Validator
      const { validActions, validationErrors } = ActionValidator.validate(actions);

      if (validActions.length === 0) {
        const errMsgs = validationErrors.map(e => e.message).join(' and ');
        const responseText = `I understood your request, but ran into an issue: ${errMsgs}`;
        VoiceSessionManager.addInteraction(transcript, responseText);
        VoiceSessionManager.endSession();
        return { message: responseText, error: true };
      }

      // 3. Planner
      const executionPlan = Planner.plan(validActions);

      // 4. CommandBus Execution
      const results = [];
      for (const action of executionPlan) {
        const result = await CommandBus.execute(action, executionContext);
        results.push(result);
        ResultCollector.addResult(sessionId, result);
        
        if (result.needsConfirmation || result.needsDisambiguation || result.needsOptionSelection || result.needsClarification) {
           ConfirmationManager.setPendingAction({
              action: action,
              needsConfirmation: result.needsConfirmation,
              needsDisambiguation: result.needsDisambiguation,
              needsOptionSelection: result.needsOptionSelection,
              needsClarification: result.needsClarification,
              missingFields: result.missingFields,
              options: result.matches || result.options
           });
           
           // Summarize previous successes if any, then add current prompt
           const previousResults = results.slice(0, -1);
           const prevSummary = previousResults.length > 0 ? ResponseSummarizer.summarize(previousResults) : '';
           const finalMessage = prevSummary ? `${prevSummary} ${result.message}` : result.message;
           
           VoiceSessionManager.addInteraction(transcript, finalMessage);
           VoiceSessionManager.endSession();
           return { 
              success: previousResults.some(r => r.status === 'SUCCESS'), 
              message: finalMessage, 
              needsClarification: true, // for voice to restart listening
              needsConfirmation: result.needsConfirmation,
              needsDisambiguation: result.needsDisambiguation,
              needsOptionSelection: result.needsOptionSelection,
              options: result.matches || result.options
           };
        }
        
        // For STOP_VOICE results, end immediately
        if (result.data && result.data.stopped) {
          VoiceSessionManager.addInteraction(transcript, result.message);
          VoiceSessionManager.endSession();
          return { success: true, message: result.message, stopped: true };
        }

        if (!result.recoverable && result.status === 'ERROR') {
          break; // Stop execution on fatal error
        }
      }

      // 5. Result Collector & Summarizer
      const finalSummary = ResponseSummarizer.summarize(results);
      
      VoiceSessionManager.addInteraction(transcript, finalSummary);
      VoiceSessionManager.endSession();

      return { 
        success: results.some(r => r.status === 'SUCCESS'), 
        message: finalSummary 
      };

    } catch (error) {
      console.error("[VoiceController] Pipeline Error:", error);
      VoiceSessionManager.endSession();
      
      // ── Friendly internet error handling ──
      const errMsg = (error.message || '') + (error.cause ? ` ${error.cause.message || ''}` : '');
      const errCode = error.code || (error.cause && error.cause.code) || '';
      
      if (CONNECTIVITY_ERRORS.some(code => errMsg.includes(code) || errCode === code)) {
        return { 
          error: "It looks like I can't reach the internet right now. My brain needs an internet connection to work. Please check your connection and try again.",
          needsClarification: false
        };
      }
      
      if (errMsg.includes('API_KEY_MISSING')) {
        return {
          error: "I need an API key to function. Please go to the Home page and set up your Groq API key in the settings.",
          needsClarification: false
        };
      }
      
      if (errMsg.includes('timeout') || errMsg.includes('Timeout')) {
        return {
          error: "The AI service took too long to respond. Please try again in a moment.",
          needsClarification: false
        };
      }

      return { error: 'Sorry, I encountered an unexpected error. Please try again.' };
    }
  }
}

module.exports = new VoiceController();
