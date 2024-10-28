/**
 * @template {DWBaseTask} T
 */
class WorkerQueue
{
  constructor()
  {
    /** @type {T[]} */
    this._queue = [];
    this._idPrefix = `${+new Date()}_`
    this._taskId = 0;
    this._free = true;
    /** @type {Promise<any>} */
    this._lastTask = undefined;
  }
  _getTaskId()
  {
    return this._idPrefix + this._taskId++;
  }
  /** @param {T} task */
  postTask(task)
  {
    let id = this._getTaskId();
    this._queue.push({...task, id});
    if (this._free) {
      this._lastTask = this._tick();
    }
    return id;
  }
  removeTask(id)
  {
    let idx = this._queue.findIndex(it=>it.id === id);
    if (idx < 0) return;
    this._queue.splice(idx, 1)[0].onCancelled?.("Task removed");
  }
  async stop()
  {
    this._queue = [];
    if (this._lastTask) {
      await this._lastTask;
    }
  }
  async _tick()
  {
    if (!this._free || !this._queue.length) {
      return;
    };
    this._free = false;
    let item = this._queue.shift();
    try {
      await item.task();
    } catch (error) {
      console.error("queued task exception", {error, item});
      try {
        item.onCancelled?.("Task crushed");
      } catch (error) {
        console.error("queued task onCancelled exception", error);
      }
    }
    this._free = true;
    if (this._queue.length) {
      // execute in new stack
      process.nextTick(()=>{this._lastTask = this._tick()});
    }
  }
}

module.exports = {
  WorkerQueue,
}