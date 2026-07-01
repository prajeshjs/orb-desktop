/**
 * CommandBus
 * 
 * The execution layer of Orb AI Core.
 * Receives an Execution Plan from the AI Core, executes the Actions sequentially
 * via registered Capabilities, and triggers Rollbacks/Recovery if a step fails.
 */

const CapabilityRegistry = require('./CapabilityRegistry');
const RecoveryManager = require('./RecoveryManager');

class CommandBus {
    constructor() {
        this.history = [];
    }

    /**
     * Executes a single legacy action
     * @param {Object} action 
     * @param {Object} executionContext 
     */
    async execute(action, executionContext) {
        // Create a single-action execution plan wrapper
        const executionPlan = {
            Actions: [
                {
                    capability: action.intent,
                    payload: action
                }
            ],
            Dependencies: [],
            RollbackStrategy: "ignore",
            ConfirmationRequirements: "none",
            Priority: "normal",
            ExpectedResult: "action executed",
            UIUpdates: []
        };
        
        const result = await this.executePlan(executionPlan, executionContext);
        // The legacy system expects result to be the first action's result
        if (result.data && result.data.length > 0) {
            const firstResult = result.data[0];
            // map it back to legacy format
            firstResult.duration = result.duration;
            return firstResult;
        }
        return result;
    }

    /**
     * Executes a full Execution Plan
     * @param {Object} executionPlan The structured plan
     * @param {Object} executionContext Global state and dependencies
     */
    async executePlan(executionPlan, executionContext) {
        const startTime = Date.now();
        const completedActions = [];
        
        const overallResult = {
            status: 'SUCCESS',
            message: '',
            data: [],
            duration: 0,
            recovered: false
        };

        if (!executionPlan || !Array.isArray(executionPlan.Actions)) {
            overallResult.status = 'ERROR';
            overallResult.message = 'Invalid execution plan format. Expected "Actions" array.';
            return overallResult;
        }

        for (const actionReq of executionPlan.Actions) {
            const capabilityName = actionReq.capability;
            // The capability registry maps intents to capabilities.
            // But we should be able to get a capability by intent or name.
            // Let's assume actionReq.capability is the 'intent' string (e.g. 'CREATE_TASK')
            const capability = CapabilityRegistry.getCapability(capabilityName);

            if (!capability) {
                console.error(`[CommandBus] Capability not found in registry: ${capabilityName}`);
                overallResult.status = 'ERROR';
                overallResult.message = `Capability not found: ${capabilityName}`;
                break;
            }

            console.log(`[CommandBus] Executing: ${capabilityName}`);

            // 1. Check if can execute
            if (typeof capability.canExecute === 'function') {
                const canRun = await capability.canExecute(executionContext.currentState);
                if (!canRun) {
                    overallResult.status = 'ERROR';
                    overallResult.message = `Capability ${capabilityName} cannot execute in current state.`;
                    break;
                }
            }

            // 2. Validate
            if (typeof capability.validate === 'function') {
                const validation = capability.validate(actionReq.payload);
                if (!validation.valid) {
                    overallResult.status = 'ERROR';
                    overallResult.message = `Validation failed for ${capabilityName}: ${validation.error}`;
                    break;
                }
            }

            // 3. Execute with Retry
            const execResult = await RecoveryManager.executeWithRetry(
                capability, 
                actionReq.payload, 
                executionContext, 
                2 // max 2 retries
            );

            if (execResult && execResult.status === 'ERROR') {
                console.error(`[CommandBus] Action failed permanently: ${execResult.message}`);
                overallResult.status = 'ERROR';
                overallResult.message = `Failed at step ${capabilityName}: ${execResult.message}`;
                break; // Stop executing subsequent actions
            }

            // Successfully executed
            completedActions.push({
                action: actionReq.payload,
                capability: capability,
                result: execResult
            });
            
            overallResult.data.push(execResult);
        }

        // Handle Rollback if the plan failed midway
        if (overallResult.status === 'ERROR' && completedActions.length > 0) {
            console.log(`[CommandBus] Execution Plan failed. Triggering Rollback Strategy: ${executionPlan.RollbackStrategy}`);
            if (executionPlan.RollbackStrategy !== 'ignore') {
                await RecoveryManager.rollback(completedActions, executionContext, executionPlan);
                overallResult.recovered = true;
            }
        } else if (overallResult.status === 'SUCCESS') {
            overallResult.message = `Successfully executed ${completedActions.length} actions.`;
        }

        overallResult.duration = Date.now() - startTime;

        // Store in history for Observability
        this.history.push({
            plan: executionPlan,
            result: overallResult,
            timestamp: Date.now()
        });

        return overallResult;
    }
}

module.exports = new CommandBus();
