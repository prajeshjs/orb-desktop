const EventBus = require('./voice/core/EventBus');
const StateEngine = require('./voice/core/StateEngine');
const CapabilityRegistry = require('./voice/core/CapabilityRegistry');
const RecoveryManager = require('./voice/core/RecoveryManager');
const CommandBus = require('./voice/core/CommandBus');
const OrbAICore = require('./voice/core/OrbAICore');
const ApplicationRequestPlanner = require('./voice/planning/ApplicationRequestPlanner');
const QueryEngine = require('./voice/engines/QueryEngine');
const WorkflowEngine = require('./voice/engines/WorkflowEngine');
const RecommendationEngine = require('./voice/engines/RecommendationEngine');
const ResponseGenerator = require('./voice/output/ResponseGenerator');
const TaskService = require('./voice/services/TaskService');
const AnalyticsService = require('./voice/services/AnalyticsService');
const ScheduleService = require('./voice/services/ScheduleService');

console.log('All modules loaded successfully without syntax errors!');
