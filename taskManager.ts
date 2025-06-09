import * as fs from 'fs';
import * as path from 'path';

// Interface for the host object that starts TaskManager
interface TaskManagerHost {
  sendMessage(conversationId: string, message: string): void;
  queryLLM(userId: string, textPrompt: string, conversationId: string, isSystem: boolean): Promise<string>;
}

// Define interfaces and types
interface BackgroundTaskConfig {
  userId: string;
  conversationId: string;
  textPrompt: string; // AI prompt to send to LLM each time
  title: string; // Title of the task (3-40 characters)
  durationMs: number;
  intervalMs: number;
}

// Serializable version of RunningTask for persistence
interface SerializedTask {
  jobId: string;
  config: BackgroundTaskConfig;
  startTime: number;
}

interface RunningTask {
  jobId: string;
  config: BackgroundTaskConfig;
  startTime: number;
  timeoutId: NodeJS.Timeout;
  intervalId: NodeJS.Timeout;
}

class TaskManager {
  private tasks: Map<string, RunningTask> = new Map();
  private userConversationPrompts: Map<string, Set<string>> = new Map(); // userId_conversationId -> Set of textPrompts
  private userTaskTitles: Map<string, Set<string>> = new Map(); // userId -> Set of task titles
  private static MAX_DURATION_MS = 3 * 30 * 24 * 60 * 60 * 1000;
  private static MIN_TITLE_LENGTH = 3;
  private static MAX_TITLE_LENGTH = 40;
  private readonly MAX_TASKS_PER_USER: number;
  private storageDir: string;
  private host: TaskManagerHost;

  constructor(host: TaskManagerHost, storageDir: string = './tasks', maxTasksPerUser: number = 2) {
    this.host = host;
    this.storageDir = storageDir;
    this.MAX_TASKS_PER_USER = maxTasksPerUser;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.loadTasksFromDisk();
  }

  private generateJobId(userId: string, conversationId: string, textPrompt: string): string {
    return `${userId}_${conversationId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private validateDuration(durationMs: number): boolean {
    return durationMs > 0 && durationMs <= TaskManager.MAX_DURATION_MS;
  }

  private validateTitle(userId: string, title: string): string | null {
    if (title.length < TaskManager.MIN_TITLE_LENGTH) {
      return "Task title is too short (minimum 3 characters)";
    }
    const truncatedTitle = title.slice(0, TaskManager.MAX_TITLE_LENGTH);
    const userTitles = this.userTaskTitles.get(userId) || new Set();
    if (userTitles.has(truncatedTitle)) {
      return `User already has a task with title "${truncatedTitle}"`;
    }
    return null;
  }

  private getTaskFilePath(jobId: string): string {
    return path.join(this.storageDir, `${jobId}.json`);
  }

  private saveTaskToDisk(task: RunningTask): void {
    const serializedTask: SerializedTask = {
      jobId: task.jobId,
      config: task.config,
      startTime: task.startTime
    };
    fs.writeFileSync(this.getTaskFilePath(task.jobId), JSON.stringify(serializedTask, null, 2));
  }

  private removeTaskFromDisk(jobId: string): void {
    const filePath = this.getTaskFilePath(jobId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  private async loadTasksFromDisk(): Promise<void> {
    const files = fs.readdirSync(this.storageDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(this.storageDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SerializedTask;

      const remainingTime = data.config.durationMs - (Date.now() - data.startTime);
      if (remainingTime <= 0) {
        this.removeTaskFromDisk(data.jobId);
        continue;
      }

      const config: BackgroundTaskConfig = { ...data.config };

      const intervalId = setInterval(async () => {
        const response = await this.host.queryLLM(data.config.userId, config.textPrompt, data.config.conversationId, false);
        if (response) console.log(`LLM Response for task ${data.jobId}: ${response}`);
      }, config.intervalMs);

      const timeoutId = setTimeout(() => {
        this.stopTask(data.jobId);
      }, remainingTime);

      const task: RunningTask = {
        jobId: data.jobId,
        config,
        startTime: data.startTime,
        timeoutId,
        intervalId
      };

      this.tasks.set(data.jobId, task);
      const promptKey = `${data.config.userId}_${data.config.conversationId}`;
      const prompts = this.userConversationPrompts.get(promptKey) || new Set();
      prompts.add(data.config.textPrompt);
      this.userConversationPrompts.set(promptKey, prompts);

      const titleKey = data.config.userId;
      const titles = this.userTaskTitles.get(titleKey) || new Set();
      titles.add(data.config.title);
      this.userTaskTitles.set(titleKey, titles);
    }
  }

  /**
   * Starts a new background task for a user.
   * @param {BackgroundTaskConfig} config - The configuration for the background task including userId, conversationId, textPrompt, and title.
   * @returns {string | null} The job ID of the started task, or null if the task couldn't be started (e.g., same prompt or title already running for user, or task limit reached).
   * @example
   * const jobId = taskManager.startTask({
   *   userId: "user123",
   *   conversationId: "chat456",
   *   textPrompt: "Monitor price and notify if below 100",
   *   title: "Price Monitor",
   *   durationMs: 604800000, // 7 days
   *   intervalMs: 3600000    // 1 hour
   * });
   */
  public startTask(config: BackgroundTaskConfig): string | null {
    const { userId, conversationId, textPrompt, durationMs, title } = config;

    // Check task limit
    const userTasks = Array.from(this.tasks.values()).filter(task => task.config.userId === userId);
    if (userTasks.length >= this.MAX_TASKS_PER_USER) {
      return `User has reached the maximum limit of ${this.MAX_TASKS_PER_USER} tasks`;
    }

    // Validate title
    const titleError = this.validateTitle(userId, title);
    if (titleError) {
      return titleError;
    }

    // Check for duplicate prompt
    const key = `${userId}_${conversationId}`;
    const prompts = this.userConversationPrompts.get(key) || new Set();
    if (prompts.has(textPrompt)) {
      return null;
    }

    if (!this.validateDuration(durationMs)) {
      return null;
    }

    const truncatedTitle = title.slice(0, TaskManager.MAX_TITLE_LENGTH);
    const jobId = this.generateJobId(userId, conversationId, textPrompt);

    const intervalId = setInterval(async () => {
      const response = await this.host.queryLLM(userId, textPrompt, conversationId, false);
      if (response) console.log(`LLM Response for task ${jobId}: ${response}`);
    }, config.intervalMs);

    const timeoutId = setTimeout(() => {
      this.stopTask(jobId);
    }, durationMs);

    const task: RunningTask = {
      jobId,
      config: { ...config, title: truncatedTitle },
      startTime: Date.now(),
      timeoutId,
      intervalId
    };

    this.tasks.set(jobId, task);
    prompts.add(textPrompt);
    this.userConversationPrompts.set(key, prompts);
    const titles = this.userTaskTitles.get(userId) || new Set();
    titles.add(truncatedTitle);
    this.userTaskTitles.set(userId, titles);
    this.saveTaskToDisk(task);

    return jobId;
  }

  /**
   * Stops a running background task.
   * @param {string} jobId - The ID of the task to stop.
   * @returns {boolean} True if the task was stopped, false if it wasn't found.
   * @example
   * const stopped = taskManager.stopTask("user123_chat456_123456789");
   * console.log(stopped ? "Task stopped" : "Task not found");
   */
  public stopTask(jobId: string): boolean {
    const task = this.tasks.get(jobId);
    if (!task) return false;

    clearInterval(task.intervalId);
    clearTimeout(task.timeoutId);

    const key = `${task.config.userId}_${task.config.conversationId}`;
    const prompts = this.userConversationPrompts.get(key);
    if (prompts) {
      prompts.delete(task.config.textPrompt);
      if (prompts.size === 0) {
        this.userConversationPrompts.delete(key);
      }
    }

    const titles = this.userTaskTitles.get(task.config.userId);
    if (titles) {
      titles.delete(task.config.title);
      if (titles.size === 0) {
        this.userTaskTitles.delete(task.config.userId);
      }
    }

    this.tasks.delete(jobId);
    this.removeTaskFromDisk(jobId);
    this.host.sendMessage(task.config.conversationId, `Task ${jobId} has completed or been stopped.`);
    return true;
  }

  /**
   * Lists all running tasks for a specific user.
   * @param {string} userId - The ID of the user whose tasks to list.
   * @returns {Array<{ jobId: string; title: string; startTime: number }>} An array of task information objects containing jobId, title, and startTime.
   * @example
   * const tasks = taskManager.listTasks("user123");
   * console.log(tasks); // [{ jobId: "...", title: "Price Monitor", startTime: 123456789 }]
   */
  public listTasks(userId: string): Array<{ jobId: string; title: string; startTime: number }> {
    return Array.from(this.tasks.values())
      .filter(task => task.config.userId === userId)
      .map(task => ({
        jobId: task.jobId,
        title: task.config.title,
        startTime: task.startTime
      }));
  }
}

class TaskTool {
  private taskManager: TaskManager;

  constructor(host: TaskManagerHost, storageDir: string = './tasks', maxTasksPerUser: number = 2) {
    this.taskManager = new TaskManager(host, storageDir, maxTasksPerUser);
  }

  /**
   * Starts a new background task for a user if they don't already have one with the same prompt or title.
   * @param {string} userId - The ID of the user requesting the task.
   * @param {string} conversationId - The ID of the conversation/channel where the task was started.
   * @param {string} textPrompt - The AI prompt to send to the LLM each time the task runs.
   * @param {string} title - The title of the task (3-40 characters).
   * @param {number} durationDays - Duration in days (max 90 days).
   * @param {number} intervalSeconds - How often to run the task in seconds.
   * @returns {string} Job ID if successful, or error message if failed.
   * @example
   * const result = taskTool.startBackgroundTask(
   *   "user123",
   *   "chat456",
   *   "Monitor price and notify if below 100",
   *   "Price Monitor",
   *   7,
   *   3600
   * );
   */
  public startBackgroundTask(
    userId: string,
    conversationId: string,
    textPrompt: string,
    title: string,
    durationDays: number,
    intervalSeconds: number
  ): string {
    const config: BackgroundTaskConfig = {
      userId,
      conversationId,
      textPrompt,
      title,
      durationMs: durationDays * 24 * 60 * 60 * 1000,
      intervalMs: intervalSeconds * 1000
    };

    const jobId = this.taskManager.startTask(config);
    return jobId || "Failed to schedule task";
  }

  /**
   * Lists all running background tasks for a user.
   * @param {string} userId - The ID of the user whose tasks to list.
   * @returns {string} JSON string of task information array.
   * @example
   * const tasksJson = taskTool.listBackgroundTasks("user123");
   * console.log(JSON.parse(tasksJson));
   */
  public listBackgroundTasks(userId: string): string {
    const tasks = this.taskManager.listTasks(userId);
    return JSON.stringify(tasks, null, 2);
  }

  /**
   * Stops a specified background task for a user.
   * @param {string} userId - The ID of the user who owns the task.
   * @param {string} jobId - The ID of the task to stop.
   * @returns {string} Success message if stopped, error message if failed.
   * @example
   * const result = taskTool.stopBackgroundTask("user123", "user123_chat456_123456789");
   * console.log(result);
   */
  public stopBackgroundTask(userId: string, jobId: string): string {
    const task = this.taskManager.listTasks(userId).find(t => t.jobId === jobId);
    if (!task) {
      return "Task not found or doesn't belong to user";
    }

    const stopped = this.taskManager.stopTask(jobId);
    return stopped ? "Task stopped successfully" : "Failed to stop task";
  }
}

// Example usage with a mock host
class ChatBot implements TaskManagerHost {
  sendMessage(conversationId: string, message: string) {
    console.log(`[${conversationId}] ${message}`);
  }

  async queryLLM(userId: string, textPrompt: string, conversationId: string, isSystem: boolean): Promise<string> {
    // Mock LLM response
    return `LLM processed prompt: "${textPrompt}" for user ${userId} in conversation ${conversationId}`;
  }
}

const chatBot = new ChatBot();
const taskTool = new TaskTool(chatBot);

const userId = "user123";
const conversationId = "chat456";
const result = taskTool.startBackgroundTask(
  userId,
  conversationId,
  "Monitor price and notify if below 100",
  "Price Monitor",
  7,
  3600
);

console.log(`Task start result: ${result}`);
console.log(taskTool.listBackgroundTasks(userId));
