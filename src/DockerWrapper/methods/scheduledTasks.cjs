const fs = require("fs/promises");
const path = require("path");
const { dockerEnginesInfo, PerformanceLogsPath, deployedInfo } = require("../../Database.cjs");
const { providers } = require("../../Notifications.cjs");

const {
  timers,
} = require("../common.cjs");

const {
  AutoDeleteCheckPeriodMs,
  ContainerStateUpdatePeriodSec,
  AutoDeleteTimeoutMs,
  DumpsCheckIntervalMs,
  OldDataCleanupIntervalMs,
  PerformanceCollectionIntervalMs,
  PingCheckIntervalMs,
} = timers;

/**
 * @this {import('..').DockerWrapper}
 * @param {string} name
 */
async function _saveTimerExecuted(name)
{
  this.mdata.lastTimerExecutedMark[name] = +new Date();
  await dockerEnginesInfo.save(this.mdata);
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} name
 */
function _getTimeSinceLastExecution(name)
{
  return +new Date() - (this.mdata.lastTimerExecutedMark[name] || 0);
}

/** 
 * @this {import('..').DockerWrapper}
 * @param {string} name
 * @param {number} fullIntervalMs
 * @param {number} [minTimerDelayMs]
 * */
function _getNextTimerExecutionDelay(name, fullIntervalMs, minTimerDelayMs = 0)
{
  return Math.max(minTimerDelayMs, fullIntervalMs - (+new Date() - (this.mdata.lastTimerExecutedMark[name] || 0)));
}

/**
 * @this {import('..').DockerWrapper}
 */
function _schedulePerformanceCollection()
{
  const timerName = "performanceCollection";
  clearTimeout(this._timers[timerName]);
  this._timers[timerName] = setTimeout(()=>{
      this._queues.other.postTask({
        type: timerName,
        task: async ()=>{
          for (const pack of this._deployedPacks) {
            if (!pack.collectPerformanceData) continue;
            for (const item of pack.containersInfo) {
              if (item.isSysPcid || item.state !== "running" || item.noPs || !item.appBinPath) continue;
              const appName = item.appBinPath.split('/')[-1];
              try {
                let data = await this._containerExec({
                  containerId: item.id,
                  Cmd: ['ps', '-xo', 'pid=,pcpu=,vsz=,rss=,cputimes=,etimes=,thcount=,cmd='],
                })
                if (data.match(/executable file not found/mi)) {
                  item.noPs = true;
                  continue;
                }
                let appData = data.split('\n').find(it=>it.match(appName));
                if (!appData) throw new Error("Failed to find app data in ps output");
                let parsedData = new RegExp('^\\s*'+'([^\\s]+)\\s+'.repeat(7)).exec(appData);
                if (!parsedData) throw new Error("Failed to parse ps output");
                /** @type {(string|number)[]} */
                let record = Array.from(parsedData);
                record.splice(0, 1);
                record.push(+new Date(), "\n")
                let filename = path.join(PerformanceLogsPath, `${pack.id}.${item.pcid}.${item.cloneId}.0`);
                try {
                  await fs.access(filename);
                } catch (error) {
                  await fs.writeFile(filename, "pid,pcpu,vsz,rss,cputimes,etimes,thcount,timestamp\n")
                }
                let fileHandle = await fs.open(filename, 'a');
                await fs.writeFile(fileHandle, record.join(" ")).finally(()=>fileHandle.close())
              } catch (error) {
                this.logger.error("performanceCollection error", {packId: pack.id, containerId: item.id, error, appName});
              }
            }
          }
        },
      }).finally(async ()=>{
        await this._saveTimerExecuted(timerName);
        this._schedulePerformanceCollection()
      });
    }, this._getNextTimerExecutionDelay(timerName, PerformanceCollectionIntervalMs, 60 * 1000)
  )
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _scheduleUpdateContainersState(nextTickSec = ContainerStateUpdatePeriodSec)
{
  clearTimeout(this._timers.updateContainersState);
  this._timers.updateContainersState = setTimeout(()=>this._updateContainersState(), nextTickSec * 1000);
}

/**
 * @this {import('..').DockerWrapper}
 */
function _pingCheckTimer()
{
  this._timers._pingCheckTimeout = setTimeout(()=>{
    this._timers._pingCheckTimeout = undefined;
    this._queues.other.postTask({
      task: ()=>this._docker.ping()
          .then(()=>this._onTelemetry({pong: true}))
          .catch(()=>this._onTelemetry({pong: false}))
          .finally(()=>{
            if (!this.mdata.disabled) {
              this._timers._pingCheckTimeout = setTimeout(()=>this._pingCheckTimer(), PingCheckIntervalMs)
            }
          }),
      type: "timer_task",
    })
  }, PingCheckIntervalMs);
}

/**
 * @this {import('..').DockerWrapper}
 */
function _scheduleCheckAutoDelete(timeout = AutoDeleteCheckPeriodMs)
{
  clearTimeout(this._timers.checkAutoDelete);
  this._timers.checkAutoDelete = setTimeout(()=>{
    this._queues.other.postTask({
      type: "timer_task",
      task: ()=>this._checkAutoDeleteTick(),
    });  
    // this._stoppableChain = this._stoppableChain.then(()=>this._checkAutoDeleteTick());
  }, timeout);
}

/**
 * @this {import('..').DockerWrapper}
 */
function _scheduleCleanupOldData()
{
  const timerName = "cleanupOldData";
  clearTimeout(this._timers[timerName]);
  this._timers[timerName] = setTimeout(
    ()=>this.cleanupOldData(),
    this._getNextTimerExecutionDelay(timerName, OldDataCleanupIntervalMs, 30 * 60 * 1000)
  )
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _scheduleDumpsCheck()
{
  clearTimeout(this._timers._checkDumpsTick);
  this._timers._checkDumpsTick = setTimeout(()=>{
    this._queues.other.postTask({
      type: "_scheduleDumpsCheck",
      task: async ()=>{
        let promises = [];
        for (const it of this._deployedPacks) {
          if (!it.monitorDumps) continue;
          promises.push(
            this.getDumpsInfo({packId: it.id})
              .catch(error=>this.logger.error("_scheduleDumpsCheck", error))
          );
        }
        await Promise.all(promises);
        this._scheduleDumpsCheck();
      }
    })
  }, DumpsCheckIntervalMs);
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _checkAutoDeleteTick()
{
  this._timers.checkAutoDelete = undefined;
  let pingTimeoutTime = +new Date() - AutoDeleteTimeoutMs;
  for (const pack of this._deployedPacks) {
    if (!pack.markedForDelete && !pack.keepAlive && pack.lastPing < pingTimeoutTime) {
      try {
        this.removePack(pack.id);
      } catch (error) {
        providers.docker.postCritical("[_checkAutoDeleteTick]: exception", error);
      }
    }
  }
  this._scheduleCheckAutoDelete();
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _updateContainersState()
{
  this._timers.updateContainersState = undefined;
  try {
    let dockerContainers = await this.listContainers();
    for (const it of this._deployedPacks) {
      let stateChanged = false;
      for (const info of it.containersInfo) {
        let dockerContainer = dockerContainers.find(q=>q.Id == info.id)
        const {state, status} = info;
        if (dockerContainer) {
          info.state = dockerContainer.State;
          info.status = dockerContainer.Status;
        } else {
          info.state = 'lost';
          info.status = '404';
          it.corrupted = true;
        }
        stateChanged ||= info.state != state || info.status != status;
      }
      if (stateChanged) {
        await deployedInfo.save(it);
      }
    }
  } catch (error) {
    this.logger.error("_updateContainersState exception", error)
  }
  this._scheduleUpdateContainersState();
}

/**
 * @this {import('..').DockerWrapper}
 */
async function cleanupOldData()
{
  const timerName = "cleanupOldData";
  // can be called from web or timer
  let task = this._queues.crudImage.findTaskInQueue(it=>it.data.type == timerName)?.getPromise();
  if (!task) {
    task = this._queues.crudImage.postTask({
      type: timerName,
      task: async ()=>{
        await this._docker.pruneImages({filters: '{"dangling": ["false"], "until": ["72h"]}'});
        await this._saveTimerExecuted(timerName);
      },
    }).finally(()=>this._scheduleCleanupOldData());
  }
  await task;
}

module.exports = {
  _getNextTimerExecutionDelay,
  _getTimeSinceLastExecution,
  _saveTimerExecuted,
  _schedulePerformanceCollection,
  _scheduleUpdateContainersState,
  _pingCheckTimer,
  _scheduleCheckAutoDelete,
  _scheduleCleanupOldData,
  _scheduleDumpsCheck,
  _checkAutoDeleteTick,
  _updateContainersState,
  cleanupOldData,
}