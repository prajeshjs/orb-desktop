const BaseCapability = require('../BaseCapability');

class FilterUIViewCapability extends BaseCapability {
  describe() {
    return {
      name: 'Filter UI View',
      description: 'Filters the task list view (e.g., pending, completed, urgent, quadrant1).',
      intent: 'FILTER_UI_VIEW',
      requiredEntities: ['filterType'],
      optionalEntities: [],
      dangerous: false,
      version: '1.0.0'
    };
  }

  validate(action) {
    const { entities } = action;
    if (!entities || !entities.filterType) {
      return { valid: false, error: 'Missing filter type.' };
    }
    return { valid: true };
  }

  async execute(action, context) {
    if (!FilterUIViewCapability.appAdapter || typeof FilterUIViewCapability.appAdapter.filterUI !== 'function') {
      return { actionId: action.id, status: 'ERROR', message: 'App adapter not configured for filtering UI.' };
    }

    try {
      const { filterType } = action.entities;
      await FilterUIViewCapability.appAdapter.filterUI(filterType);
      
      return {
        actionId: action.id,
        status: 'SUCCESS',
        message: `Task list filtered by ${filterType}.`,
        data: { filterType }
      };
    } catch (error) {
      console.error('[FilterUIViewCapability] Error:', error);
      return { actionId: action.id, status: 'ERROR', message: 'Failed to filter UI.' };
    }
  }
}

FilterUIViewCapability.appAdapter = null;
module.exports = FilterUIViewCapability;
