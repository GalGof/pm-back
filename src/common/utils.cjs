const net = require("net");

function sleepSec(interval)
{
  return sleepMs(interval * 1000);
}

function sleepMs(interval)
{
  return new Promise(resolve=>setTimeout(resolve, interval));
}

/** @return {{[x:string]: {}}} */
function StrArrToObjReduce(/** @type {string[]}*/arr)
{
  return arr.reduce((prev, curr)=>({[curr]: {}, ...prev}), {});
}

/** @template T @param {Promise<T>} promise @return {Promise<{ok: true, data: T}|{ok: false, error: Error}>} */
function alwaysResolve(promise)
{
  //@ts-ignore
  return promise.then(data => ({ok: true, data})).catch(error => Promise.resolve({ok: false, error}));
}

/** @template T @param {Promise<T>} promise @return {Promise<T>} */
function markThrow(promise)
{
  return promise.catch(error => {console.error("promise exception", error); throw new Error("from here")});
}

/** @template T @param {T[]} arr @return {T[]} */
function dedublicateArray(arr)
{
  return Array.from(new Set(arr));
}

let sshPort = 2000;
const isPortOpen = async (port) => {
  return new Promise((resolve, reject) => {
      let s = net.createServer();
      s.once('error', (err) => {
          s.close();
          if (err["code"] == "EADDRINUSE") {
              resolve(false);
          } else {
              resolve(false); // or throw error!!
              // reject(err); 
          }
      });
      s.once('listening', () => {
          resolve(true);
          s.close();
      });
      s.listen(port);
  });
}

const _getNextOpenPort = async(startFrom = 2222) => {
  let openPort = null;
  while (startFrom < 65535 || !!openPort) {
      if (await isPortOpen(startFrom)) {
          openPort = startFrom;
          break;
      }
      startFrom++;
  }
  return openPort;
};

let portChain = Promise.resolve(0);
let getNextOpenPort = ()=>{
  portChain = portChain.then(()=>{
    return _getNextOpenPort(sshPort++);
  })
  return portChain;
}

const isWin = process.platform === "win32";

module.exports = {
  sleepMs,
  sleepSec,
  StrArrToObjReduce,
  markThrow,
  alwaysResolve,
  dedublicateArray,
  getNextOpenPort,
  isWin,
}