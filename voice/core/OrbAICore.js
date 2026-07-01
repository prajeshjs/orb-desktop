/**
 * Orb AI Core
 * 
 * The central brain of Orb. It bridges the Natural Language Understanding (Planner)
 * with the Execution Pipeline (CommandBus), using the Application Intelligence Engines 
 * (QueryEngine, WorkflowEngine, RecommendationEngine).
 */

const CommandBus = require('./CommandBus');
const StateEngine = require('./StateEngine');
const EventBus = require('./EventBus');
const ApplicationRequestPlanner = require('../planning/ApplicationRequestPlanner');
const QueryEngine = require('../engines/QueryEngine');
const WorkflowEngine = require('../engines/WorkflowEngine');
const RecommendationEngine = require('../engines/RecommendationEngine');
const ResponseGenerator = require('../output/ResponseGenerator');

class OrbAICore {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize the AI Core with adapters and pre-load states
     */
    init(appAdapter) {
        console.log('[OrbAICore] Initializing Intelligence Layer...');
        this.appAdapter = appAdapter;
        
        // Ensure legacy VoiceController gets the adapter if needed
        const VoiceController = require('./VoiceController');
        VoiceController.init(appAdapter);

        this.isInitialized = true;
    }

    /**
     * Process an Application Request from the User Interface (Voice/Chat)
     * @param {string} rawInput The natural language string
     * @param {Object} session Contextual session data
     */
    async processRequest(rawInput, session) {
        if (!this.isInitialized) throw new Error("Orb AI Core not initialized");
        
        const startTime = Date.now();
        
        try {
            // 1. Resolve State Context
            const context = StateEngine.getState();
            
            // 2. Parse Intent (LLM)
            const requestPlan = await ApplicationRequestPlanner.parse(rawInput, context);
            
            // 3. Intelligence Engine Resolution
            let executionPlan;
            if (requestPlan.type === 'Query') {
                executionPlan = await QueryEngine.resolve(requestPlan, context);
            } else if (requestPlan.type === 'Workflow') {
                executionPlan = await WorkflowEngine.resolve(requestPlan, context);
            } else if (requestPlan.type === 'Recommendation') {
                executionPlan = await RecommendationEngine.resolve(requestPlan, context);
            } else {
                // Standard Command
                // wrap it in execution plan schema
                executionPlan = {
                    Actions: [{ capability: requestPlan.intent, payload: requestPlan.parameters || {} }],
                    Dependencies: [],
                    RollbackStrategy: 'ignore',
                    ConfirmationRequirements: 'none',
                    Priority: 'normal',
                    ExpectedResult: 'Command execution',
                    UIUpdates: requestPlan.uiActions || []
                };
            }
            
            // 4. Execute via CommandBus
            const executionResult = await CommandBus.executePlan(executionPlan, context);
            
            // 5. Generate Response
            const response = await ResponseGenerator.generate(executionResult, requestPlan);
            
            // Log Observability trace
            console.log(`[OrbAICore] Processed request in ${Date.now() - startTime}ms`);
            
            return response;
            
        } catch (error) {
            console.error('[OrbAICore] Error processing request:', error);
            return { success: false, message: "System error: " + error.message };
        }
    }
}

module.exports = new OrbAICore();
