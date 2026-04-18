import type {
  HydriaArenaRoundWorkflowArgs
} from "./hydriaArenaWorkflowBuilder.js";
import {
  buildArenaRoundWorkflowRun
} from "./hydriaArenaWorkflowBuilder.js";
import type {
  HydriaStudentPreviewWorkflowArgs,
  HydriaStudentSessionWorkflowArgs
} from "./hydriaStudentWorkflowBuilder.js";
import {
  buildStudentPreviewWorkflowRun,
  buildStudentSessionWorkflowRun
} from "./hydriaStudentWorkflowBuilder.js";

export class HydriaCoreWorkflowService {
  buildStudentPreviewRun(args: HydriaStudentPreviewWorkflowArgs) {
    return buildStudentPreviewWorkflowRun(args);
  }

  buildStudentSessionRun(args: HydriaStudentSessionWorkflowArgs) {
    return buildStudentSessionWorkflowRun(args);
  }

  buildArenaRoundRun(args: HydriaArenaRoundWorkflowArgs) {
    return buildArenaRoundWorkflowRun(args);
  }
}
