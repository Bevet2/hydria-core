import { LocalModelService } from "../services/localModel.js";
import { OpenRouterService } from "../services/openrouter.js";
import { OrchestrationPolicyService } from "../services/orchestrationPolicy.js";
import { ResearchToolService } from "../services/researchToolService.js";
import { StudentService } from "../services/studentService.js";
import { StudentStrategyDiscoveryLoopService } from "../services/studentStrategyDiscoveryLoopService.js";
import { StudentSessionStore } from "../services/studentSessionStore.js";

const localModelService = new LocalModelService();
const openRouterService = new OpenRouterService();
const orchestrationPolicyService = new OrchestrationPolicyService();
const researchToolService = new ResearchToolService();
const studentSessionStore = new StudentSessionStore();
const studentService = new StudentService(
  localModelService,
  openRouterService,
  orchestrationPolicyService,
  researchToolService,
  studentSessionStore
);
const discoveryLoopService = new StudentStrategyDiscoveryLoopService(studentService);

await studentService.ensureReady();

const result = await discoveryLoopService.run({
  category: "other",
  maxProposals: 3,
  questionsPerProposal: 4
});

console.log(JSON.stringify(result, null, 2));
