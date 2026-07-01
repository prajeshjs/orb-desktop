/**
 * ResponseGenerator
 * 
 * Takes the Execution Result and formats it for Voice/Chat output.
 */

class ResponseGenerator {
    /**
     * Generate final response
     * @param {Object} executionResult 
     * @param {Object} requestPlan 
     */
    async generate(executionResult, requestPlan) {
        if (executionResult.status === 'ERROR') {
            return {
                success: false,
                message: executionResult.message || "I encountered an error while processing that request."
            };
        }

        // For Queries and Recommendations, the message is pre-formatted by the Engine
        if (requestPlan.type === 'Query' || requestPlan.type === 'Recommendation') {
            const dataResult = executionResult.data && executionResult.data[0];
            return {
                success: true,
                message: dataResult ? dataResult.message : "Request completed.",
                data: dataResult ? dataResult.data : null
            };
        }

        // For Commands, we join the messages of all successfully completed actions
        if (requestPlan.type === 'Command' || requestPlan.type === 'Workflow') {
            const messages = executionResult.data.map(r => r.message).filter(Boolean);
            const finalMessage = messages.length > 0 ? messages.join('. ') : "Done.";
            
            return {
                success: true,
                message: finalMessage
            };
        }

        return {
            success: true,
            message: "I've handled that for you."
        };
    }
}

module.exports = new ResponseGenerator();
