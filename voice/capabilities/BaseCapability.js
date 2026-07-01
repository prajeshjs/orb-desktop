class BaseCapability {
  
  describe() {
    throw new Error("Capability must implement describe()");
  }

  register() {
    // Optional hook for IPC or event registration
  }

  validate(action) {
    // Override if custom validation is needed beyond metadata
    return { valid: true };
  }

  async execute(action, context) {
    throw new Error("Capability must implement execute()");
  }

  async undo(action) {
    return { status: "ERROR", message: "Undo not supported" };
  }

  async canExecute(state) {
    return true; // Default to always executable
  }
}

module.exports = BaseCapability;
