const { providers } = require("../../Notifications.cjs");

/**
 * @this {import('..').DockerWrapper}
 */
async function _removeCorruptedContainers()
{
  this._queues.other.postTask({
    type: "timer_task",
    task: async ()=>{
      /** @type {string[]} */
      let deployedContainerNames = this._deployedPacks.reduce(
          (prev, curr)=>prev.concat(curr.containersInfo.map(it=>it.name)),
          []);
      let containersList = await this.listContainers();
      for (let container of containersList) {
        // docker shows here name as "/<name>"
        const normName = container.Names[0].slice(1);
        // console.log({normName, match: normName.match(/^PM_\d+_.+\d+$/), inc: !deployedContainerNames.includes(normName)})
        if (normName.match(/^PM_\d+_.+\d+$/) && !deployedContainerNames.includes(normName)) {
          providers.docker.postWarning("Unregistered container like ours",
            {id: container.Id, name: normName});
          await this._removeContainer(normName, containersList);
        }
      }
    }
  })
}

module.exports = {
  _removeCorruptedContainers,
}