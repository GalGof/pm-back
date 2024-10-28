const { deployedInfo } = require("../Database.cjs");
const { WorkerQueue } = require("../common/workerQueue.cjs");

const methods = require("./methods/index.cjs");

/** @typedef {(data: object)=>void} onTelemetryCb */

class DockerWrapper{
  /** @param {{data: DockerEngineInfo, onTelemetry: onTelemetryCb}} param */
  constructor({data, onTelemetry})
  {
    /** @type {DockerEngineInfo} */
    this.mdata = data;
    /** @type {onTelemetryCb} */
    this._onTelemetry = onTelemetry;

    this._queues = {
      other: new WorkerQueue({limit: 10}),
      crudPack: new WorkerQueue({limit: 100}),
      // https://github.com/containerd/containerd/issues/4068
      crudContainer: new WorkerQueue({limit: 100}),
      crudImage: new WorkerQueue({limit: 1}),
      prune: new WorkerQueue({limit: 1}),
      dataCollection: new WorkerQueue({limit: 1}),
      containerData: new WorkerQueue({limit: 1}),
    }
    this._reInitQueue = new WorkerQueue({limit: 1});

    const logPrefix = `[${data.id}]`;
    this.logger = {...console};
    /** @type {("trace"|"debug"|"log")[]}*/
    const logCalls = ["trace", "debug", "log"];
    for (const call of logCalls) {
      this.logger[call] = (...args)=>console[call](logPrefix, call, ...args);
    }

    /** @typedef {"updateContainersState"|"checkAutoDelete"|"_pingCheckTimeout"|"cleanupOldData"|"_checkDumpsTick"|"_schedulePerformanceCollection"|"performanceCollection"} timerNames */
    /** @type {{[x in timerNames]?: NodeJS.Timeout}} */
    this._timers = {}
    
    {
      /** @type {number} */
      this.deployChangeQueueLength = 0;
      /** @type {number} */
      this.bananaUsage = 0;
      /** @type {number} */
      this._lastPackIdx = 0;
      /** @type {number} */
      this._lastContainerIdx = 0;
      /** @type {boolean} */
      this.initialized = false;
      /** @type {boolean} */
      this.stopping = false;
      /** @type {number} */
      this.sshRetryTimeoutSec = 10;
      /** @type {number} */
      this.initRetryTimeoutSec = 10;

      /** @type {import('dockerode')} */
      this._docker = undefined;
      /** @type {number} */
      this.lastSshSpawn = undefined;
      /** @type {number} */
      this.sshPort = undefined;
      /** @type {Set<string>} */
      this._ipList = undefined;
      /** @type {import('child_process').ChildProcessWithoutNullStreams} */
      this.ssh = undefined;
      /** @type {{[x:string]: boolean}} */
      this._shared_resources_checked = undefined;
      /** @type {boolean} */
      this.removed = false;
      this.initRetryTimer = undefined;
    }
    
    this.logger.log("created");
    this.reInit(data);
  }
  get _deployedPacks() {
    return deployedInfo.getItems().filter(it=>it.dockerEngineId == this.mdata.id);
  }
  async debuggerCleanup()
  {
    // check active packs for unused ip. free them.
    // cleanup old performance logs for removed packs (+7d old)
  }
}

Object.entries(methods).forEach(([name, method]) => {
  //@ts-ignore
  DockerWrapper.prototype[name] = method;
});

module.exports = {
  DockerWrapper,
}