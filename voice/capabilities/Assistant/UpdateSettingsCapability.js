const BaseCapability = require('../BaseCapability');

class UpdateSettingsCapability extends BaseCapability {
  describe() {
    return {
      name: 'Update Settings',
      description: 'Changes application preferences like theme, auto-start, and floating orb.',
      intent: 'UPDATE_SETTINGS',
      requiredEntities: [],
      optionalEntities: ['theme', 'autoStartEnabled', 'floatingOrbEnabled', 'voiceEnabled', 'closingTime'],
      dangerous: false,
      version: '1.0.0'
    };
  }

  validate(action) {
    const { entities } = action;
    if (!entities) {
      return { valid: false, error: 'No settings specified to update.' };
    }
    
    // Check if at least one valid setting is provided
    const hasSetting = entities.theme !== undefined || 
                       entities.autoStartEnabled !== undefined || 
                       entities.floatingOrbEnabled !== undefined ||
                       entities.voiceEnabled !== undefined ||
                       entities.closingTime !== undefined;
                       
    if (!hasSetting) {
      return { valid: false, error: 'Could not determine which setting to update.' };
    }
    return { valid: true };
  }

  async execute(action, context) {
    if (!UpdateSettingsCapability.appAdapter || typeof UpdateSettingsCapability.appAdapter.updateSetting !== 'function') {
      return { actionId: action.id, status: 'ERROR', message: 'App adapter not configured for settings.' };
    }

    try {
      const { entities } = action;
      const updates = [];

      if (entities.theme !== undefined) {
        // theme is usually "dark" or "light"
        const theme = entities.theme.toLowerCase().includes('light') ? 'light' : 'dark';
        await UpdateSettingsCapability.appAdapter.updateSetting('theme', theme);
        updates.push(`Theme changed to ${theme}`);
      }
      
      if (entities.autoStartEnabled !== undefined) {
        // boolean mapping
        const isEnabled = String(entities.autoStartEnabled).toLowerCase() === 'true';
        await UpdateSettingsCapability.appAdapter.updateSetting('autoStartEnabled', isEnabled);
        updates.push(`Auto-start ${isEnabled ? 'enabled' : 'disabled'}`);
      }
      
      if (entities.floatingOrbEnabled !== undefined) {
        const isEnabled = String(entities.floatingOrbEnabled).toLowerCase() === 'true';
        await UpdateSettingsCapability.appAdapter.updateSetting('floatingOrbEnabled', isEnabled);
        updates.push(`Floating orb ${isEnabled ? 'enabled' : 'disabled'}`);
      }

      if (entities.voiceEnabled !== undefined) {
        const isEnabled = String(entities.voiceEnabled).toLowerCase() === 'true';
        await UpdateSettingsCapability.appAdapter.updateSetting('voiceEnabled', isEnabled);
        updates.push(`Voice features ${isEnabled ? 'enabled' : 'disabled'}`);
      }

      if (entities.closingTime !== undefined) {
        await UpdateSettingsCapability.appAdapter.updateSetting('closingTime', entities.closingTime);
        updates.push(`Closing time set to ${entities.closingTime}`);
      }

      return {
        actionId: action.id,
        status: 'SUCCESS',
        message: updates.length > 0 ? updates.join(' and ') + '.' : 'No settings updated.',
        data: { updates }
      };
    } catch (error) {
      console.error('[UpdateSettingsCapability] Error:', error);
      return { actionId: action.id, status: 'ERROR', message: 'Failed to update settings.' };
    }
  }
}

UpdateSettingsCapability.appAdapter = null;
module.exports = UpdateSettingsCapability;
