import type { HydriaArenaMemorySnapshotArgs } from "./hydriaArenaMemoryBuilder.js";
import { buildArenaMemorySnapshot } from "./hydriaArenaMemoryBuilder.js";
import type { HydriaStudentMemorySnapshotArgs } from "./hydriaStudentMemoryBuilder.js";
import { buildStudentMemorySnapshot } from "./hydriaStudentMemoryBuilder.js";

export class HydriaCoreMemoryService {
  buildStudentSnapshot(args: HydriaStudentMemorySnapshotArgs) {
    return buildStudentMemorySnapshot(args);
  }

  buildArenaSnapshot(args: HydriaArenaMemorySnapshotArgs) {
    return buildArenaMemorySnapshot(args);
  }
}
