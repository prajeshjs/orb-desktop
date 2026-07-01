/**
 * CapabilityRegistry
 * 
 * Central registry for all application capabilities (Commands, Queries, Workflows).
 * Exposes all manifests to the Planner and Knowledge Engine.
 */

class CapabilityRegistry {
    constructor() {
        this.manifests = new Map();
        this.capabilities = new Map();
    }

    /**
     * Register a capability and its manifest
     * @param {Object} manifest The JSON manifest or legacy capability
     * @param {Object} capabilityInstance The executable capability instance
     */
    register(manifest, capabilityInstance) {
        // Legacy support: if only one argument is passed, assume it's a legacy capability
        if (arguments.length === 1 && typeof manifest.describe === 'function') {
            const cap = manifest;
            const desc = cap.describe();
            const newManifest = {
                name: desc.name,
                intent: desc.intent,
                aliases: [],
                requiredEntities: desc.requiredEntities || [],
                optionalEntities: desc.optionalEntities || [],
                confirmationTier: desc.dangerous ? 'high' : 'none',
                permissions: [],
                supportedOperations: ['EXECUTE'],
                uiActions: [],
                version: desc.version || '1.0.0'
            };
            this.manifests.set(newManifest.intent, newManifest);
            this.capabilities.set(newManifest.intent, cap);
            
            // Legacy capability register hook
            if (typeof cap.register === 'function') {
                cap.register();
            }
            
            console.log(`[CapabilityRegistry] Registered legacy capability: ${newManifest.name} (${newManifest.intent}) v${newManifest.version}`);
            return;
        }

        if (!manifest || !manifest.intent) {
            throw new Error("Invalid manifest. Must contain an 'intent' field.");
        }
        this.manifests.set(manifest.intent, manifest);
        this.capabilities.set(manifest.intent, capabilityInstance);
        console.log(`[CapabilityRegistry] Registered capability: ${manifest.name} (${manifest.intent}) v${manifest.version}`);
    }

    /**
     * Get a manifest by intent
     * @param {string} intent 
     * @returns {Object}
     */
    getManifest(intent) {
        return this.manifests.get(intent);
    }

    /**
     * Get the executable capability instance by intent
     * @param {string} intent 
     * @returns {Object}
     */
    getCapability(intent) {
        return this.capabilities.get(intent);
    }

    /**
     * Get all registered manifests (used by Planner and Knowledge Engine)
     * @returns {Array} Array of manifests
     */
    getAllManifests() {
        return Array.from(this.manifests.values());
    }

    /**
     * Automatically discover and load all capabilities from the capabilities directory
     * This makes plugins and new features automatically register themselves.
     */
    loadCapabilities() {
        // Implementation for auto-loading capabilities would go here.
        // For now, we will manually register them or build an index loader.
        console.log(`[CapabilityRegistry] Load capability system initialized.`);
    }
}

// Export as a singleton
module.exports = new CapabilityRegistry();
