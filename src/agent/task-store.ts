import type {TaskState, AgentConfig, AgentResult} from "./types.js";

const CLEANUP_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * In-memory task state storage.
 * Tasks are lost on process restart — acceptable for Phase 1.
 */
export class TaskStore {
    private tasks = new Map<string, TaskState>();

    /** Create a new task and return its state. */
    createTask(config: AgentConfig): TaskState {
        this.cleanup();

        const taskId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const task: TaskState = {
            taskId,
            status: "running",
            config,
            currentStep: "Initializing...",
            iterationCount: 0,
            filesRead: [],
            tokensUsed: 0,
            startedAt: Date.now(),
        };
        this.tasks.set(taskId, task);
        return task;
    }

    /** Get a task by ID. */
    getTask(taskId: string): TaskState | undefined {
        return this.tasks.get(taskId);
    }

    /** Update progress from Worker IPC status message. */
    updateProgress(taskId: string, step: string, iteration: number, filesRead: string[], tokensUsed: number): void {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== "running") return;
        task.currentStep = step;
        task.iterationCount = iteration;
        task.filesRead = filesRead;
        task.tokensUsed = tokensUsed;
    }

    /** Mark task as completed. */
    completeTask(taskId: string, result: AgentResult): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = "completed";
        task.result = result;
        task.completedAt = Date.now();
        task.workerProcess = undefined;
    }

    /** Mark task as failed. */
    failTask(taskId: string, error: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = "failed";
        task.error = error;
        task.completedAt = Date.now();
        task.workerProcess = undefined;
    }

    /** Mark task as cancelled. */
    cancelTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = "cancelled";
        task.completedAt = Date.now();
        task.workerProcess = undefined;
    }

    /** Remove completed/failed/cancelled tasks older than maxAgeMs. */
    private cleanup(): void {
        const now = Date.now();
        for (const [id, task] of this.tasks) {
            if (task.status !== "running" && task.completedAt && now - task.completedAt > CLEANUP_MAX_AGE_MS) {
                this.tasks.delete(id);
            }
        }
    }
}
