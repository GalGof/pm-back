class WorkerQueue
{
  // /** @typedef {{id, resolve, reject, data: {task: ()=>Promise<T>, type: string; params?: object}, queueTime, getPromise: ()=>Promise<T>}} someTask */
  constructor({limit = 1})
  {
    /** @type {DWQTask[]} */
    this._queue = [];
    /** @type {DWQTask[]} */
    this._tasksInProgress = [];
    this._idPrefix = `${+new Date()}_`
    this._taskId = 0;
    this._free = true;
    this._limit = limit;
    this._active = 0;
    this.disabled = false;
  }
  findTaskInQueue(/** @type {(it: DWQTask)=>boolean}*/cb)
  {
    return this._queue.find(cb);
  }
  findTaskInProgress(/** @type {(it: DWQTask)=>boolean}*/cb)
  {
    return this._queue.find(cb) || this._tasksInProgress.find(cb);
  }
  _getTaskId()
  {
    return this._idPrefix + this._taskId++;
  }
  /**
   * @template V
   * @param {{type: string, task: ()=>Promise<V>, params?: any}} data 
   * @returns {Promise<V>} 
  */
  postTask(data)
  {
    let queueTime = +new Date();
    let getPromise = ()=>promise
    let promise = new Promise((resolve, reject)=>{
      // @ts-ignore
      this._queue.push({id: this._getTaskId(), resolve, reject, data, queueTime, getPromise});
      if (this._active < this._limit && !this.disabled) {
        // execute in separate stack
        process.nextTick(()=>this._runTask());
      }
    }).finally(()=>{
      console.debug("Worker queue total time:", data.type, +new Date() - queueTime);
    });
    return promise;
  }
  removeTask(/** @type {string}*/id)
  {
    let idx = this._queue.findIndex(it=>it.id === id);
    if (idx < 0) return;
    let task = this._queue.splice(idx, 1)[0];
    task.reject("Task removed: " + task.data.type);
  }
  async stop()
  {
    this.disabled = true;
    for (const item of this._queue) {
      item.reject("queue reset: " + item.data.type);
    }
    this._queue = [];
    await Promise.all(this._tasksInProgress);
  }
  start()
  {
    this.disabled = false;
    for (let i = 0; i < Math.min(this._limit - this._active, this._queue.length); i++) {
      this._runTask();
    }
  }
  async _runTask()
  {
    if (!this._queue.length || this.disabled) return;
    this._active++;
    let start = +new Date();
    let item = this._queue.shift();
    this._tasksInProgress.push(item);
    try {
      item.resolve(await item.data.task());
    } catch (error) {
      console.error("queued task exception", {error, item});
      item.reject({error: error instanceof Error ? String(error) : error, message: "Task crushed: " + item.data.type});
    }
    let idx = this._tasksInProgress.findIndex(it=>it == item);
    this._tasksInProgress.splice(idx, 1);
    let fin = +new Date();
    let diff = fin - start;
    console.log("Worker queue task type, duration, queue lag", item.data.type,  diff, fin - item.queueTime - diff);
    this._active--;
    process.nextTick(()=>this._runTask());
  }
}

module.exports = {
  WorkerQueue,
}