const { dockerRegistriesInfo } = require("../../Database.cjs");
const { MWritable } = require("../../common/streams.cjs");
const { ResourcesRegistryId } = require("../common.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {object} param0
 * @param {string[]} param0.cmd
 * @param {string[]} [param0.binds]
 * @param {boolean} [param0.privileged]
 */
async function execEngineHost({binds, cmd, privileged = false})
{
  this.logger.log("execEngineHost queued", {binds, cmd, privileged});
  return this._queues.other.postTask({
    type: "patch_engine_host",
    task: async ()=>{
      const outputStream = new MWritable();
      let registry = dockerRegistriesInfo.getItems().find(it=>it.id == ResourcesRegistryId);
      let imageName = `${registry.address}/alpine`;
      await this._pullImage(imageName);
      let result = await this._docker.run(
          imageName,
          cmd,
          outputStream,
          {HostConfig: {Binds: binds, AutoRemove: true, Privileged: privileged}}
        )
        .then(([output, container])=>{
          this.logger.debug("patchEngineHost data", output);
          return output;
        })
        .catch(error=>{this.logger.error("patchEngineHost error", error)})
      let stdout = outputStream.buffer.toString("utf-8");
      let results = {stdout, result}
      this.logger.log("execEngineHost results", results);
      return results;
    },
  })
}

module.exports = {
  execEngineHost,
}