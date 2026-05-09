import { LocalStudentTrainingEnvService } from "../services/training/localStudentTrainingEnvService.js";

const service = new LocalStudentTrainingEnvService();
const report = await service.check();

console.log(JSON.stringify(report, null, 2));
