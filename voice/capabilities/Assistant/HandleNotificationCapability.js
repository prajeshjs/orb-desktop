const BaseCapability = require('../BaseCapability');

class HandleNotificationCapability extends BaseCapability {
  describe() {
    return {
      name: 'Handle Notification',
      description: 'Responds to active popups/notifications like snoozing or acknowledging.',
      intent: 'HANDLE_NOTIFICATION',
      requiredEntities: ['action'],
      optionalEntities: [],
      dangerous: false,
      version: '1.0.0'
    };
  }

  validate(action) {
    const { entities } = action;
    if (!entities || !entities.action) {
      return { valid: false, error: 'Missing action for the notification (snooze, dismiss, etc.).' };
    }
    return { valid: true };
  }

  async execute(action, context) {
    if (!HandleNotificationCapability.appAdapter || typeof HandleNotificationCapability.appAdapter.handleActiveNotification !== 'function') {
      return { actionId: action.id, status: 'ERROR', message: 'App adapter not configured for notifications.' };
    }

    try {
      const { action: notifAction } = action.entities;
      const result = await HandleNotificationCapability.appAdapter.handleActiveNotification(notifAction.toLowerCase());
      
      if (!result.success) {
         return { actionId: action.id, status: 'ERROR', message: result.error || 'Failed to handle notification.' };
      }

      return {
        actionId: action.id,
        status: 'SUCCESS',
        message: result.message || `Notification handled with action: ${notifAction}.`,
        data: { action: notifAction }
      };
    } catch (error) {
      console.error('[HandleNotificationCapability] Error:', error);
      return { actionId: action.id, status: 'ERROR', message: 'Failed to handle notification.' };
    }
  }
}

HandleNotificationCapability.appAdapter = null;
module.exports = HandleNotificationCapability;
