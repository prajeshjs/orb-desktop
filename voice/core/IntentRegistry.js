class IntentRegistry {
  constructor() {
    this.capabilities = new Map(); // Map intent string to Capability object
    this.skillsMetadata = [];
  }

  register(capability) {
    const metadata = capability.describe();
    if (!metadata || !metadata.intent) {
      throw new Error("Capability must provide metadata with an 'intent' field via describe().");
    }

    this.capabilities.set(metadata.intent, capability);
    this.skillsMetadata.push(metadata);
    
    // Also call capability's own register method if it needs to hook into IPC or events
    if (typeof capability.register === 'function') {
      capability.register();
    }
    
    console.log(`[IntentRegistry] Registered capability: ${metadata.name} for intent: ${metadata.intent}`);
  }

  getCapability(intent) {
    return this.capabilities.get(intent) || null;
  }

  getAllMetadata() {
    return this.skillsMetadata;
  }

  // Capability Discovery
  discoverCapabilities() {
    return this.skillsMetadata.map(m => m.name).join(', ');
  }
}

module.exports = new IntentRegistry(); // Singleton
