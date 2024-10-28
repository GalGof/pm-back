const Docker = require('dockerode');
const { spawn } = require('child_process');
const fs = require("fs/promises");
const _fs = require("fs");

const { getSSHKeyByName } = require("../../Database.cjs");
const { providers } = require("../../Notifications.cjs");
const { isWin, getNextOpenPort } = require("../../common/utils.cjs");
const { c_blank } = require("../../common/callbackUtils.cjs");
const { 
  pmNetworkName,
  proxySocketsPath,
} = require("../common.cjs");

if (!_fs.existsSync(proxySocketsPath)) {
  _fs.mkdirSync(proxySocketsPath, {recursive: true});
}

// (this) cause of https://github.com/microsoft/TypeScript/issues/43812

/**
 * @this {import('..').DockerWrapper}
 */
function _setupSshSocket()
{
  const socketPath = proxySocketsPath + "/" + this.mdata.id;
  const user = this.mdata.connection.username || "root";
  const hostIp = this.mdata.connection.host;
  let sshKeyInfo = this.mdata.connection.protocol == "ssh" 
    ? getSSHKeyByName(this.mdata.connection.sshKey)
    : undefined;
  (this).lastSshSpawn = + new Date();
  this.logger.debug('[setupSshSocket]: new spawn.', this.sshPort);
  return new Promise((resolve, reject)=>{
    (this).ssh = spawn('ssh', [
        '-nNT',
        '-L', isWin ? `localhost:${this.sshPort}:/var/run/docker.sock` : `${socketPath}:/var/run/docker.sock`,
        '-i', './database/sshKeyFiles/test',
        // '-i', sshKeyInfo.private,
        '-o', 'StrictHostKeyChecking=no',
        `${user}@${hostIp}`,
    ]);
    this.ssh.stdout.on('data', (data) => {
      this.logger.debug(`ssh stdout: ${data}`);
    });

    this.ssh.stderr.on('data', (data) => {
      this.logger.error(`ssh stderr: ${data}`);
    });
    this.ssh.addListener('error', (err)=>{
      this._onTelemetry({sshSpawn: false});
      this.logger.debug('[setupSshSocket]: SSH spawner error:', err);
      reject("error");
    });
    this.ssh.addListener('spawn', ()=>{
      this._onTelemetry({sshSpawn: true});
      this.logger.debug('[setupSshSocket]: SSH redirect spawned.')
      resolve();
    });
    this.ssh.addListener('close', async (...args)=>{
      // can it be closed without spawn first?
      reject("closed");
      this._onTelemetry({sshSpawn: false, pong: false});
      if (this.stopping) return;
      this.logger.error(`[setupSshSocket]: Seems like spawned SSH closed. try to respawn in ${this.sshRetryTimeoutSec}sec.`, args);
      if (!isWin) {
        await fs.unlink(socketPath).catch(c_blank);
      }
      if (this.mdata.disabled) return;
      (this).sshRetryTimeoutSec = Math.min(this.sshRetryTimeoutSec + 10, 300);
      setTimeout(()=>this._setupSshSocket(), this.sshRetryTimeoutSec * 1000);
    });
    this.ssh.addListener('message', (...args)=>this.logger.debug("ssh message:", ...args));
  })
}

/**
 * @this {import('..').DockerWrapper}
 * @param {DockerEngineInfo} data
 */
async function _initData(/** @type {DockerEngineInfo} */ data)
{
  data.lastTimerExecutedMark = this.mdata.lastTimerExecutedMark || {};
  if (data.bananasLimit === undefined) data.bananasLimit = 100;
  if (!data.labels) data.labels = [data.id];
  if (!data.labels.includes(data.id)) {
    data.labels.push(data.id);
  }
  (this).mdata = data;
  
  if (!this.sshPort) {
    (this).sshPort = await getNextOpenPort();
  }
  
  if (!this._docker) {
    const socketPath = proxySocketsPath + "/" + this.mdata.id;
    (this)._docker = isWin 
      ? new Docker({
        protocol: "http",
        host: "localhost",
        port: this.sshPort,
      }) 
      : new Docker({
        socketPath,
      })
  }

  (this)._ipList = new Set();
  if (data.network.ipList) {
    data.network.ipList.forEach(it=>this._ipList.add(it));
  }
  if (data.network.ipRange) {
    let parts = /^(\d+\.\d+\.\d+\.)(\d+)/.exec(data.network.ipRange.start);
    let prefix = parts[1];
    let start = +parts[2];
    for (let i = 0; i < data.network.ipRange.count; i++) {
      this._ipList.add(prefix + (start + i));
    }
  }

  {
    const _deployedPacks = this._deployedPacks;
    for (const it of _deployedPacks) {
      for (const ip of it.ipList) {
        this._ipList.delete(ip);
      }
    }
    this.logger.log("ipList", this._ipList);
    if (_deployedPacks.length) {
      (this)._lastPackIdx = Math.max(..._deployedPacks.map(it=>+/^(\d+)_/.exec(it.id)[1]));
      (this)._lastContainerIdx = Math.max(..._deployedPacks.map(it=>Math.max(...it.containersInfo.map(it2=>+/^PM_(\d+)_/.exec(it2.name)[1]))));
    }
    this.logger.log({_lastPackIdx: this._lastPackIdx, _lastContainerIdx: this._lastContainerIdx});
  }

  (this)._shared_resources_checked = {};
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _initDocker()
{
  // not really guarantees no network problems next steps, but at least shows 'stable' network problem
  await this._setupSshSocket();

  /** @type {(limit?: number)=>Promise<void>} */
  const pingOk = async (limit = 3)=>{
    if (limit < 0) throw new Error("Ping timeout");
    try {
      await this._docker.ping();
      (this).sshRetryTimeoutSec = 10;
      this._onTelemetry({pong: true});
      this.logger.log("init ping Ok");
    } catch (error) {
      this.logger.log("init ping Failed, retry");
      return new Promise((resolve)=>setTimeout(()=>resolve(pingOk(limit--)), 1000));
    }
  }
  await pingOk();

  {
    // start timers
    this._scheduleUpdateContainersState(5);
    this._scheduleCheckAutoDelete()
    this._scheduleCleanupOldData();
    this._scheduleDumpsCheck();
    this._schedulePerformanceCollection();
  }

  {
    // ensure there is known docker network on host for packs internal usage
    // *allows to use sniffer (filter specific containers) on internal docker network
    // as external assigned ip's wont really be used by containers for outcoming connections
    let networks = await this._docker.listNetworks();
    let customNetworkInfo = networks.find(it=>it.Name == pmNetworkName);
    // let hasCustromNetwork = await this._docker.getNetwork(pmNetworkName).inspect().then(c_true).catch(c_false);
    if (!customNetworkInfo) {
      this.mdata.network.gateway = undefined;
      for (let sub = 254; sub > 0; sub--) {
        this.mdata.network.gateway = `172.${sub}.0.1`;
        let gateway = this.mdata.network.gateway;
        if (!networks.find(it=>it.IPAM.Config.find(it2=>it2.Gateway == gateway))) {
          break;
        }
      }
      if (!this.mdata.network.gateway) {
        throw new Error("Failed to find free gateway for PM");
      }
      await this._docker.createNetwork({
        Name: pmNetworkName,
        Driver: "bridge",
        // EnableIPv6: true,
        CheckDuplicate: true,
        Internal: false,
        IPAM: {
          Driver: "default",
          Config: [
            {
              Subnet: this.mdata.network.gateway.replace(/\.(\d+)$/, ".0/16"),
              Gateway: this.mdata.network.gateway
            }
          ]
        },
        Options: {
          "com.docker.network.bridge.enable_icc": "true",
          "com.docker.network.bridge.enable_ip_masquerade": "true",
          "com.docker.network.bridge.host_binding_ipv4": "0.0.0.0",
          "com.docker.network.bridge.name": pmNetworkName,
          "com.docker.network.driver.mtu": "1500"  
        }
      })
    } else {
      this.mdata.network.gateway = customNetworkInfo.IPAM.Config[0].Gateway;
    }
  }

  {
    // check for unknown containers on host
    // something might be wrong is they are present
    // like dublicated connection to controller or some unexpected corruption on data/process
    let deployedContainerNames = this._deployedPacks.reduce((prev, curr)=>prev.concat(curr.containersInfo.map(it=>it.name)), []);
    let containersList = await this._docker.listContainers({all: true});
    for (let container of containersList) {
      const normName = container.Names[0].slice(1);
      if (normName.match(/^PM_\d+_.+\d+$/) && !deployedContainerNames.includes(normName)) {
        providers.docker.postWarning("Unregistered container like ours", {id: container.Id, name: normName});
      }
    }
  }

  {
    for (let it of this._deployedPacks) {
      if (it.bananaLoad) this.bananaUsage += it.bananaLoad;
      if (it.deployInProgress || it.markedForDelete) {
        this.removePack(it.id);
      }
    }
  }
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _stop()
{
  (this).initialized = false;
  (this).stopping = true;
  for (const it of Object.values(this._timers)) {
    clearTimeout(it);
  }
  (this)._timers = {};
  await Promise.all(Object.values(this._queues).map(it=>it.stop()));
  if (this.ssh) {
    let timeout;
    await new Promise((resolve, reject)=>{
      this.ssh.addListener("close", resolve);
      timeout = setTimeout(()=>reject("wait for ssh closed timeout"), 10000);
      this.ssh.kill();
    });
    clearTimeout(timeout);
    (this).ssh = undefined;
  }
}

/**
 * @this {import('..').DockerWrapper}
 */
async function destroy()
{
  (this).removed = true;
  clearTimeout(this.initRetryTimer);
  await this._reInitQueue.stop();
  this._reInitQueue.disabled = false;
  this.mdata.disabled = true;
  this._reInitQueue.postTask({type: "destroy", task: ()=>this._stop()})
    .catch(err=>{
      this.logger.error("critical destroy docker wrapper failed...", err);
      process.exit(1);
    });
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _reInit(/** @type {DockerEngineInfo} */ data)
{
  this.logger.log("_reInit start")
  await this._stop();
  await this._initData(data);
  if (data.disabled) {
    this.logger.log("_reInit engine disabled");
    return;
  }
  (this).stopping = false;
  await this._initDocker();
  for (const it of Object.values(this._queues)) {
    it.start();
  }

  if (this.mdata.autoSetCorePattern) {
    await this.execEngineHost({
      cmd: ["sysctl", "kernel.core_pattern=/tmp/cores/core.%e.%p.%h.%t"],
      privileged: true,
    });
  }

  (this).initialized = true;
  (this).initRetryTimeoutSec = 10;
  this.logger.log("_reInit finished");
}

/**
 * @this {import('..').DockerWrapper}
 */
async function reInit(/** @type {DockerEngineInfo} */ data)
{
  if (this.removed) return;
  clearTimeout(this.initRetryTimer);
  // each data save calls for reinit, multiple reinits may be queued at the same time.
  // only last saved data relevant..
  await this._reInitQueue.stop();
  this._reInitQueue.disabled = false;

  this._reInitQueue.postTask({type: "re_init", task: ()=>this._reInit(data)})
    .catch(err=>{
      this.logger.error("reInit failed, retry pending...", err);
      (this).initRetryTimeoutSec = Math.min(this.initRetryTimeoutSec + 10, 300);
      (this).initRetryTimer = setTimeout(()=>this.reInit(data), this.initRetryTimeoutSec * 1000)
    });
}

module.exports = {
  _setupSshSocket,
  _initData,
  _initDocker,
  _reInit,
  _stop,
  destroy,
  reInit,
}