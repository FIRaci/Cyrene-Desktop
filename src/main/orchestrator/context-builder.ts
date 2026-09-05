// Orchestrator Context Builder - post-chat side effects (memory write + Reflection)
import { memoryScheduler } from "../memory/memory-scheduler";

export function scheduleMemoryWrite(userInput: string, assistantReply: string): void {
  memoryScheduler.scheduleMemoryWrite(userInput, assistantReply);
}
