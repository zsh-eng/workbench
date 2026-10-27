import type { PaginationEngineWork } from "../engine";
import type { PaginationCommand } from "../protocol";
import {
  coalesceQueuedCommands,
  getCoalesceKey,
  getCommandPriority,
  startsLayoutEpoch,
  type PaginationJobPriority,
  type QueuedPaginationCommand,
} from "./scheduler-policy";

export interface ScheduledPaginationJob {
  coalesceKey: string | null;
  eventEpoch: number | null;
  priority: PaginationJobPriority;
  startsLayout: boolean;
  /** The chapter an `addChapter` job lays out. */
  chapterIndex: number | null;
  work: PaginationEngineWork;
}

/**
 * Owns command inbox expansion and prioritized job queues.
 * Jobs stay at the head of their priority queue until done, so layout work can
 * resume naturally after user-priority commands preempt it at yield boundaries.
 */
export class PaginationJobScheduler {
  private incomingCommands: QueuedPaginationCommand[] = [];
  private userJobs: ScheduledPaginationJob[] = [];
  private layoutJobs: ScheduledPaginationJob[] = [];
  private backgroundJobs: ScheduledPaginationJob[] = [];
  private createEngineWork: (
    command: PaginationCommand,
  ) => PaginationEngineWork;
  private wantedChapter: () => number | null;

  /**
   * `wantedChapter` names a chapter that a waiting jump needs: its
   * `addChapter` runs before other background work.
   */
  constructor(
    createEngineWork: (command: PaginationCommand) => PaginationEngineWork,
    wantedChapter: () => number | null = () => null,
  ) {
    this.createEngineWork = createEngineWork;
    this.wantedChapter = wantedChapter;
  }

  pushCommand(command: PaginationCommand): void {
    this.incomingCommands.push({ command });
  }

  expandIncomingCommands(): void {
    if (this.incomingCommands.length === 0) return;

    const commands = coalesceQueuedCommands(this.incomingCommands);
    this.incomingCommands = [];

    for (const { command } of commands) {
      this.enqueueCommand(command);
    }
  }

  peek(): ScheduledPaginationJob | null {
    const wanted = this.wantedChapter();
    return (
      this.userJobs[0] ??
      this.layoutJobs[0] ??
      (wanted === null
        ? undefined
        : this.backgroundJobs.find((job) => job.chapterIndex === wanted)) ??
      this.backgroundJobs[0] ??
      null
    );
  }

  remove(job: ScheduledPaginationJob): void {
    const queue = this.queueForPriority(job.priority);
    if (queue[0] === job) {
      queue.shift();
      return;
    }

    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  }

  hasWork(): boolean {
    return (
      this.incomingCommands.length > 0 ||
      this.userJobs.length > 0 ||
      this.layoutJobs.length > 0 ||
      this.backgroundJobs.length > 0
    );
  }

  /** Cancels all work owned by the current Reader session. */
  cancelAll(): void {
    this.incomingCommands = [];
    this.clearJobQueues();
  }

  private enqueueCommand(command: PaginationCommand): void {
    if (command.type === "init") {
      this.clearJobQueues();
    }

    const coalesceKey = getCoalesceKey(command);
    this.removeSupersededJobs(coalesceKey);

    const priority = getCommandPriority(command);
    const job: ScheduledPaginationJob = {
      coalesceKey,
      eventEpoch: null,
      priority,
      startsLayout: startsLayoutEpoch(command),
      chapterIndex: command.type === "addChapter" ? command.chapterIndex : null,
      work: this.createEngineWork(command),
    };

    this.queueForPriority(priority).push(job);
  }

  private clearJobQueues(): void {
    for (const job of [
      ...this.userJobs,
      ...this.layoutJobs,
      ...this.backgroundJobs,
    ]) {
      this.cancelJob(job);
    }
    this.userJobs = [];
    this.layoutJobs = [];
    this.backgroundJobs = [];
  }

  private removeSupersededJobs(coalesceKey: string | null): void {
    if (!coalesceKey) return;

    const keepJob = (job: ScheduledPaginationJob) => {
      const keep = job.coalesceKey !== coalesceKey;
      if (!keep) this.cancelJob(job);
      return keep;
    };
    this.userJobs = this.userJobs.filter(keepJob);
    this.layoutJobs = this.layoutJobs.filter(keepJob);
    this.backgroundJobs = this.backgroundJobs.filter(keepJob);
  }

  private cancelJob(job: ScheduledPaginationJob): void {
    job.work.return(undefined);
  }

  private queueForPriority(
    priority: PaginationJobPriority,
  ): ScheduledPaginationJob[] {
    switch (priority) {
      case "user":
        return this.userJobs;
      case "layout":
        return this.layoutJobs;
      case "background":
        return this.backgroundJobs;
    }
  }
}
