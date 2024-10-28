var fs = require('fs');
var util = require('util');

/** @type {fs.WriteStream} */
var logFile = null;
/** @type {fs.WriteStream} */
var logErrFile = null;
let logN = 0;
let logErrN = 0;
let logSize = 0;
let logErrSize = 0;

const logsDir = './logs';
const logFileMaxSize = 10 * 1024 * 1024;

function createOutFile()
{
  logSize = 0;
  logFile = fs.createWriteStream(`./logs/log_${logN++}.txt`, { flags: 'a' });
}

function createErrFile()
{
  logErrSize = 0;
  logErrFile = fs.createWriteStream(`./logs/logErr_${logErrN++}.txt`, { flags: 'a' });
}
  
async function initLog()
{
  await fs.promises.mkdir(logsDir).catch(()=>{});
  let names = fs.readdirSync(logsDir);
  for (const name of names) {
    {
      let match = name.match(/log_(\d+)\.txt/);
      if (match) {
        logN = Math.max(logN, +match[1]);
      }
    }
    {
      let match = name.match(/logErr_(\d+)\.txt/);
      if (match) {
        logErrN = Math.max(logErrN, +match[1]);
      }
    }
  }
  try {
    logSize = (await fs.promises.stat(`./logs/log_${logN}.txt`)).size;
  } catch (error) {}
  try {
    logErrSize = (await fs.promises.stat(`./logs/logErr_${logErrN}.txt`)).size;
  } catch (error) {}
  createOutFile();
  createErrFile();

  console.log = function () {
    const chunk = new Date().toISOString() + " " + util.format.apply(null, arguments) + '\n'
    logFile.write(chunk);
    process.stdout.write(chunk);
    logSize += chunk.length;
    if (logSize > logFileMaxSize) {
      createOutFile();
    }
  }

  console.error = function () {
    const chunk = new Date().toISOString() + " " + util.format.apply(null, arguments) + '\n'
    {
      logFile.write(chunk);
      logSize += chunk.length;
      if (logSize > logFileMaxSize) {
        createOutFile();
      }
    }
    {
      logErrFile.write(chunk);
      process.stderr.write(chunk);
      logErrSize += chunk.length;
      if (logErrSize > logFileMaxSize) {
        createErrFile();
      }
    }
  }

  console.debug = console.log;
  console.trace = console.log;
  console.warn = console.log;
}


module.exports = {
  initLog,
}