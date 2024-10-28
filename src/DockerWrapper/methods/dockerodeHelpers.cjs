const { dockerStreamToString } = require("../../common/dockerUtils.cjs");
const { sleepSec } = require("../../common/utils.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {string} containerId 
 * @param {{timeout?: number, signal?: string}} [options]
 */
async function _stopContainer(containerId, {timeout = 600, signal = undefined} = {})
{
  try {
    await this._docker.getContainer(containerId).stop({t: timeout, signal})
  } catch (error) {
    if (!error.message.match(/container already stopped/)) {
      throw error;
    }
  }
}

/**
 * @this {import('..').DockerWrapper}
 * @param {import('dockerode').ContainerCreateOptions} options
 */
async function _dockerCreateContainer(options)
{
  return this._queues.crudContainer.postTask({
    type: "create_container",
    task: ()=>this._docker.createContainer(options),
  })
}

/**
 * remove by name - as we may have send createContainer requiest but got no id from result cause of some exception midway (network & etc)
 * so reliably we only have name to work with here
 * @this {import('..').DockerWrapper}
 * @param {string} name 
 * @param {import('dockerode').ContainerInfo[]=} [containersList]
 */
async function _removeContainer(name, containersList)
{
  return this._queues.crudContainer.postTask({
    type: "delete_container",
    task: async ()=>{
      this.logger.log("_removeContainer", {name, preloadedList: !!containersList});
      // "/"+name - https://github.com/moby/moby/issues/6705
      let nameMatcher = new RegExp(`^/?${name}$`)
      let container = (containersList || await this.listContainers()).find(it=>it.Names[0].match(nameMatcher));
      // might be removed during interrupted update/deploy/remove..
      if (container) {
        await this._docker.getContainer(container.Id).remove({force: true, v: true});
        this.logger.log("_removeContainer found, removed", {name});
      } else {
        this.logger.log("_removeContainer not found", {name});
      }
    },
    params: {name}
  })
}

/**
 * @this {import('..').DockerWrapper}
 * @param {object} param0 
 * @param {string} param0.containerId
 * @param {boolean} [param0.includeStdOut]
 * @param {string} [param0.WorkingDir]
 * @param {string[]} param0.Cmd
 * @param {boolean} [param0.stdin]
 * @param {number} [param0.timeoutSec]
 */
async function _containerExec({
  containerId,
  includeStdOut = true,
  WorkingDir = "/",
  Cmd,
  stdin=false,
  timeoutSec = 60,
})
{
  this.logger.log("_containerExec", arguments)
  let container = this._docker.getContainer(containerId);
  let exec = await container.exec({
    Cmd,
    WorkingDir,
    AttachStderr: includeStdOut,
    AttachStdout: includeStdOut,
  });
  let ac = new AbortController();
  let timeout = setTimeout(()=>ac.abort("timeout"), timeoutSec * 1000);
  let dockerExecStream = await exec.start({stdin, abortSignal: ac.signal});
  let content = await dockerStreamToString({stream: dockerExecStream});
  clearTimeout(timeout);
  return content;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {NodeJS.ReadableStream} stream
 */
function _followProgress(stream)
{
  this.logger.log("_followProgress");
  let progressLength = 0;
  return new Promise((resolve, reject)=>{
    this._docker.modem.followProgress(
      stream,
      (err, res) => err ? reject(err) : resolve(res),
      (obj)=>{
        progressLength++;
        this.logger.log("_followProgress", obj)
      }
    );
  }).finally(()=>this.logger.debug("_followProgress length", progressLength));
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} imageName
 */
async function _pullImage(imageName)
{
  let task = this._queues.crudImage.findTaskInQueue(it=>it.data.type == "pull" && it.data.params.imageName === imageName)?.getPromise();
  if (!task) {
    task = this._queues.crudImage.postTask({
      type: "pull",
      task: async ()=>{
        let progress = await this._docker.pull(imageName);
        await this._followProgress(progress);
      },
      params: {imageName},
    })
  }
  await task;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {{containerId: string, webSocket: WebSocket, hijack?: boolean}} param
 */
async function attachContainer({containerId, webSocket, hijack = false})
{
  this.logger.log("attachContainer", {containerId});
  const stream = await this._docker.getContainer(containerId)
    .attach({
      stdout: true,
      stderr: true,
      stdin: true,
      stream: true,
      detachKeys: "ctrl-d",
      hijack,
    });
  webSocket.onclose = ()=>stream.end();
  webSocket.onmessage = (data)=>stream.write(data.data);
  stream.on('data', (chunk) => webSocket.send(Buffer.from(chunk)));
  stream.on('error', (err) => webSocket.close(4001, String(err).slice(0, 123)));
  stream.on('end', () => webSocket.close(4002, "stream ended"));
}

/**
 * @this {import('..').DockerWrapper}
 * @param {{containerId: string, webSocket: WebSocket, hijack?: boolean, Cmd: string[]}} param
 */
async function liveExecContainer({containerId, webSocket, Cmd, hijack = false})
{
  this.logger.log("liveExecContainer", {containerId, Cmd, hijack});
  const exec = await this._docker.getContainer(containerId)
    .exec({
      Tty: true,
      Cmd,
      // DetachKeys: "ctrl-d",
      AttachStderr: true,
      AttachStdin: true,
      AttachStdout: true,
    });
  const stream = await exec.start({hijack, stdin: true, Tty: true});
  webSocket.send("0started")
  webSocket.onclose = ()=>{
    this.logger.log("liveExecContainer ws closed")
    stream.destroy();
  };
  webSocket.onmessage = (data)=>{
    try {
      // this.logger.log("liveExecContainer >>>", data.data)
      let isTerminalMsg = data.data[0] === "1";
      let message = data.data.slice(1);
      if (isTerminalMsg) {
        stream.write(message)
      } else {
        /** @type {{command: string, params: any}} */
        let data = JSON.parse(message);
        if (data.command == "resize") {
          exec.resize(data.params).catch((error)=>{
            this.logger.error("liveExecContainer resize error", error);
          })
        }
      }
    } catch (error) {
      this.logger.error(error);
    }
  };
  stream.on('data', (chunk) => {
    // this.logger.log("liveExecContainer chunk <<<", chunk)
    webSocket.send("1"+chunk)
  });
  stream.on('error', (err) => webSocket.close(4001, String(err).slice(0, 123)));
  stream.on('end', () => webSocket.close(4002, "stream ended"));
}

/**
 * @this {import('..').DockerWrapper}
 * @returns {Promise<import('dockerode').ContainerInfo[]>}
 */
function listContainers()
{
  const taskType = "list_containers";
  let task = this._queues.other.findTaskInQueue(it=>it.data.type == taskType)?.getPromise();
  if (!task) {
    task = this._queues.other.postTask({
      type: taskType,
      task: ()=>this._docker.listContainers({all: true}),
    })
  }
  return task;
}

/**
 * @this {import('..').DockerWrapper}
 */
function getContainer(/** @type {string} */ id)
{
  return this._docker.getContainer(id);
}

/**
 * @this {import('..').DockerWrapper}
 * @param {{id: string}} param0
 */
async function containerInspect({id})
{
  return await this._docker.getContainer(id).inspect();
}

/**
 * @this {import('..').DockerWrapper}
 * @param {{id: string, tail: number, since: string|number, timestamps?: boolean}} param
 */
async function getContainerLogs({id, tail, since, timestamps=true})
{
  let logs = await this._queues.other.postTask({
    type: "get_container_logs",
    task: ()=>this._docker.getContainer(id).logs({stderr: true, stdout: true, tail, since, timestamps}),
  });
  return dockerStreamToString({buffer: logs});
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} containerId
 */
async function _startAndWaitForContainer(containerId)
{
  const container = this._docker.getContainer(containerId);
  let isActive = async ()=>{
    let info = await container.inspect();
    this.logger.log(`[waitForContainerStarted][${containerId}]: State: `, info.State);
    return (info.State.Running || info.State.Restarting);
  }
  let triesLeft = 5;
  let started = false;
  while (triesLeft > 0)
  {
      --triesLeft;
      try {
          this.logger.debug(`[waitForContainerStarted][${containerId}]: Container start called:`);
          await container.start();
          this.logger.debug(`[waitForContainerStarted][${containerId}]: Container start call finished.`);
      } catch (error) {
          this.logger.error(`[waitForContainerStarted][${containerId}]: Exception:`, error.message, error.stack);
      } finally {
          let active = await isActive();
          if (active)
          {
              started = true;
              break;
          }
          await sleepSec(1);
      }
  }
  if (!started)
  {
      this.logger.error(`[waitForContainerStarted][${containerId}]: Failed to start container.`);
      throw new Error('Unexpected');
  }

}

/**
 * @this {import('..').DockerWrapper}
 * @param {{containerId: string, data: {action: string, timeout?: number, signal?: string, updateState? : boolean}}} param0
 */
async function changeContainerState({ containerId, data })
{
  const container = this._docker.getContainer(containerId);
  if (!container) throw new Error("Container not found");
  this.logger.log("changeContainerState", { containerId, data });
  if (data.action == "restart")
  {
    await container.restart({t: data.timeout === undefined ? 30 : data.timeout});
  } else if (data.action == "stop")
  {
    await container.stop({t: data.timeout === undefined ? 30 : data.timeout});
  } else if (data.action == "start")
  {
    await container.start();
  } else if (data.action == "pause")
  {
    await container.pause();
  } else if (data.action == "unpause")
  {
    await container.unpause();
  } else if (data.action == "kill")
  {
    let signal = data.signal ? data.signal : "SIGKILL";
    await container.kill({signal});
  } else
  {
    throw new Error("Unexpected action: "+data.action);
  }
  if (data.updateState)
  {
    this._scheduleUpdateContainersState(5);
  }
}


module.exports = {
  _stopContainer,
  _dockerCreateContainer,
  _removeContainer,
  _containerExec,
  _followProgress,
  _pullImage,
  attachContainer,
  liveExecContainer,
  listContainers,
  getContainer,
  containerInspect,
  getContainerLogs,
  changeContainerState,
  _startAndWaitForContainer,
}