const CapabilityRegistry = require('../core/CapabilityRegistry');

class ActionValidator {

  validate(actions) {
    const validActions = [];
    const validationErrors = [];

    for (const action of actions) {
      const capability = CapabilityRegistry.getCapability(action.intent);
      
      if (!capability) {
        validationErrors.push({
          actionId: action.id,
          message: `Unknown intent: ${action.intent}`,
          action: action
        });
        continue;
      }

      const metadata = capability.describe();
      let isValid = true;

      // Check required entities
      if (metadata.requiredEntities && metadata.requiredEntities.length > 0) {
        for (const req of metadata.requiredEntities) {
          if (!action.entities || action.entities[req] === undefined || action.entities[req] === null) {
            validationErrors.push({
              actionId: action.id,
              message: `Missing required entity '${req}' for intent ${action.intent}`,
              action: action
            });
            isValid = false;
            break;
          }
        }
      }

      // Capability-specific custom validation
      if (isValid && typeof capability.validate === 'function') {
        const customValidation = capability.validate(action);
        if (!customValidation.valid) {
          validationErrors.push({
            actionId: action.id,
            message: customValidation.error,
            action: action
          });
          isValid = false;
        }
      }

      if (isValid) {
        validActions.push(action);
      }
    }

    return {
      validActions,
      validationErrors
    };
  }

}

module.exports = new ActionValidator();
