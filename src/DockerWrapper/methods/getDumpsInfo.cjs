const { deployedInfo } = require("../../Database.cjs");

const {
  SysPcid,
  kernelDumps,
} = require("../common.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {{packId: string}} param0 
 * @returns {Promise<PackDumpsInfo>}
 */
async function getDumpsInfo({packId})
{
  const expectedConfig = kernelDumps.expectedConfig;
  const taskType = "getDumpsInfo";
  let task = this._queues.other.findTaskInQueue(it=>it.data.type == taskType && it.data.params?.packId == packId)?.getPromise();
  if (!task) {
    task = this._queues.other.postTask({
      type: taskType,
      params: {packId},
      task: async ()=>{
        const pack = this._getPack({packId});
        /** @type {PackDumpsInfo} */
        let collectedData = {
          config: {
            current: undefined,
            expected: expectedConfig,
            isOk: undefined,
          },
          dumps: {},
          errors: [],
        };
        const walleId = pack.containersInfo.find(it=>it.pcid == SysPcid.wallE).id;
        try {
          collectedData.config.current = (await this._containerExec({
            containerId: walleId,
            Cmd: ['cat', '/proc/sys/kernel/core_pattern'],
            WorkingDir: `/`,
            includeStdOut: true,
          })).trim();
          collectedData.config.isOk = collectedData.config.current === expectedConfig;
        } catch (error) {
          this.logger.error("getDumpsInfo get config error", error);
          collectedData.errors.push(String(error));
        }
        for (let it of pack.containersInfo) {
          if (it.pcid in SysPcid) continue;
          if (!collectedData.dumps[it.pcid]) {
            collectedData.dumps[it.pcid] = {
              manual: [], my: [], others: [],
            }
          }
          let dumpsInfo = collectedData.dumps[it.pcid];
          try {
            let list = await this._containerExec({
              containerId: walleId,
              Cmd: ['ls'],
              WorkingDir: `/HostDumpsRoot/${it.pcid}`,
              includeStdOut: true,
            });
            // container internal hostname assigned by docker
            const hostname = it.id.substr(0, 12);
            let myDumpsMatcher = new RegExp(`^core\\..+\\.${hostname}\\.`);
            let kernelHookDumps = new RegExp(`^core\\..+\\.\\d+`);
            let gcoreDumps = new RegExp(`^core\\..+`);
            for (let filename of list) {
              if (myDumpsMatcher.test(filename)) {
                dumpsInfo.my.push(filename);
              } else if (kernelHookDumps.test(filename)) {
                dumpsInfo.others.push(filename);
              } else if (gcoreDumps.test(filename)) {
                dumpsInfo.manual.push(filename);
              }
            }
          } catch (error) {
            this.logger.error("getDumpsInfo get pcid data error", it.pcid, error);
            collectedData.errors.push(it.pcid + ": " +String(error));
          }
        }
        pack.lastDumpsCheck = +new Date();
        pack.lastDumpsInfo = collectedData;
        await deployedInfo.save(pack);
        return collectedData;
      }
    })
  }
  return await task;
}

module.exports = {
  getDumpsInfo,
}