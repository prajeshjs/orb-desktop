const BaseCapability = require('../BaseCapability');

class OpenWindowCapability extends BaseCapability {
  describe() {
    return {
      name: "Open Window",
      intent: "OPEN_WINDOW",
      category: "Window",
      version: "1.0",
      dangerous: false,
      supportsUndo: true,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["window"],
      optionalEntities: [],
      priority: 10
    };
  }

  async execute(action, context) {
    const windowName = action.entities.window;
    console.log(`[WindowControl] Opening window: ${windowName}`);
    
    if (context && context.appAdapter) {
      const result = await context.appAdapter.openWindow(windowName);
      return {
        actionId: action.id,
        status: result.success ? "SUCCESS" : "ERROR",
        message: result.message || (result.success ? `Opened the ${windowName} window` : `Failed to open ${windowName}`),
        data: { window: windowName, originalResult: result },
        recoverable: true
      };
    }
    
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Opened the ${windowName} window (Simulation)`,
      data: { window: windowName },
      recoverable: true
    };
  }
}

class CloseWindowCapability extends BaseCapability {
  describe() {
    return {
      name: "Close Window",
      intent: "CLOSE_WINDOW",
      category: "Window",
      version: "1.0",
      dangerous: false,
      supportsUndo: true,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["window"],
      optionalEntities: [],
      priority: 10
    };
  }

  async execute(action, context) {
    const windowName = action.entities.window;
    console.log(`[WindowControl] Closing window: ${windowName}`);
    
    if (context && context.appAdapter) {
      const result = await context.appAdapter.closeWindow(windowName);
      return {
        actionId: action.id,
        status: result.success ? "SUCCESS" : "ERROR",
        message: result.message || (result.success ? `Closed the ${windowName} window` : `Failed to close ${windowName}`),
        data: { window: windowName, originalResult: result },
        recoverable: true
      };
    }
    
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Closed the ${windowName} window (Simulation)`,
      data: { window: windowName },
      recoverable: true
    };
  }
}

const FilterUIViewCapability = require('./FilterUIViewCapability');

module.exports = {
  OpenWindowCapability: new OpenWindowCapability(),
  CloseWindowCapability: new CloseWindowCapability(),
  FilterUIViewCapability: new FilterUIViewCapability()
};
