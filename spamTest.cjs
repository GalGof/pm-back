var fs = require('fs');
var util = require('util');
const mark = +new Date();
var logFile = fs.createWriteStream(`./logs/logSpam_${mark}.txt`, { flags: 'a' });
var logErrFile = fs.createWriteStream(`./logs/logSpam_${mark}_Err.txt`, { flags: 'a' });
  // Or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;
var logStderr = process.stderr;

console.log = function () {
  const chunk = util.format.apply(null, arguments) + '\n'
  logFile.write(chunk);
  logStdout.write(chunk);
}
console.error = function () {
  const chunk = util.format.apply(null, arguments) + '\n'
  logErrFile.write(chunk);
  logStderr.write(chunk);
}
console.debug = console.log;
console.trace = console.log;
console.warn = console.log;

['SIGINT', 'SIGTERM'].forEach(function (signal) {
  process.on(signal, function () {
    process.exit(0);
  });
});

process.on('uncaughtException', function (err) {
  console.error("uncaughtException 1:", err);
  // console.error("uncaughtException 2:", err.message, err.stack);
  process.exit(1);
});

(async function Init() {
  const { WorkerQueue } = require("./src/common/workerQueue.cjs");
  const Docker = require("dockerode")
  const {db_collections} = require("./src/BaseDatabase.cjs");
  const { dockerEnginesInfo, } = require("./src/Database.cjs");
    const {initSSHKeys, dockerRegistriesInfo, getSSHKeyByName} = require("./src/Database.cjs");

  await Promise.all(Object.values(db_collections).map(it=>it.init().catch(error=>{
    console.error(it.dbName, "db init exception", error);
    process.exit(2);
  })));
  await initSSHKeys();
  const data = dockerEnginesInfo.getItems().find(it=>!it.disabled);
  const sshKeyInfo = getSSHKeyByName(data.connection.sshKey);

  let docker = new Docker({
    host: data.connection.host,
    protocol: data.connection.protocol,
    username: data.connection?.username || "root",
    sshOptions: data.connection.protocol == "ssh" ? {
      host: data.connection.host,
      port: data.connection?.port || 22,
      passphrase: sshKeyInfo.passphrase,
      privateKey: sshKeyInfo.private,
      // keepaliveCountMax: 10,
      // keepaliveInterval: 10000,
    } : undefined,
  });
  if (true) {
    const { spawn, execSync } = require('child_process');
    const _fs = require("fs");
    const net = require("net");
    
    await new Promise((resolve)=>
    {
      const user = data.connection.username || "root";
      const hostIp = data.connection.host;
      this.ssh = spawn('ssh', [
          '-nNT',
          // '-L', `${socketPath}:/var/run/docker.sock`,
          '-L', `localhost:2000:/var/run/docker.sock`,
          '-i', './database/sshKeyFiles/test',
          // '-i', sshKeyInfo.private,
          '-o', 'StrictHostKeyChecking=no',
          `${user}@${hostIp}`,
      ]);
      this.ssh.stdout.on('data', (data) => {
          console.log(`ssh stdout: ${data}`);
      });
  
      this.ssh.stderr.on('data', (data) => {
        console.error(`ssh stderr: ${data}`);
      });
      this.ssh.addListener('error', (err)=>{
        console.log('[setupSshSocket]: SSH spawner error:', err);
      });
      this.ssh.addListener('spawn', ()=>{console.log('[setupSshSocket]: SSH redirect spawned.')});
      this.ssh.addListener('close', (...args)=>{
        console.error(`[setupSshSocket]: Seems like spawned SSH closed.`, args);
      });
      this.ssh.addListener('message', (...args)=>console.debug("ssh message:", ...args));
      setTimeout(resolve, 5000);
    })
  
    docker = new Docker({
      protocol: "http",
      host: "localhost",
      port: 2000,
      timeout: 1000,
    });
  }

  let queue = new WorkerQueue(10);
  const {GetStreamDataStr} = require("./src/common/dockerUtils.cjs");

  // const containers = (await docker.listContainers()).map(it=>it.Id);
  const containers = ["5254bbbd76e8bc9e61b269eed75210094c40b3d2e2fff153a7a9cc3ad7d99b86"]
  const imageName = "teststand:5000/alpine";

  function _followProgress(/**@type {NodeJS.ReadableStream} */stream)
  {
    console.log("_followProgress");
    let progressLength = 0;
    return new Promise((resolve, reject)=>{
      docker.modem.followProgress(
        stream,
        (err, res) => err ? reject(err) : resolve(res),
        (obj)=>{
          progressLength++;
          console.log("_followProgress", obj)
        }
      );
    }).finally(()=>console.debug("_followProgress length", progressLength));
  }


  for (let i = 0; i < 1000; i++) {
    queue.postTask({
      // task: ()=>docker.getContainer(containers[i % containers.length]).inspect(),
      // task: async ()=>{
      //   let exec = await docker.getContainer(containers[i % containers.length]).exec({
      //   Cmd: ["ps", "-ef"],
      //   WorkingDir: "/",
      //   AttachStderr: true,
      //   AttachStdout: true,
      //   Tty: true,
      // })
      //   let stream = await exec.start({stdin: true});
      //   let content = await GetStreamDataStr({stream});
      //   console.log(content)
      //   return content;
      // },
      // task: async ()=>{
      //   let container = await docker.createContainer({Image: "alpine"})
      //   await container.remove({force: true, v: true})
      // },
      task: async ()=>{
        let progress = await docker.pull(imageName);
        await _followProgress(progress);
      },
    });
  }
})()

setInterval(()=>{console.log("ping")}, 60000);