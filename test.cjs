// https://github.com/apocas/dockerode/issues/764


// process.on('uncaughtException', function (err) {
//   console.error("uncaughtException:", err.stack);
// });

const Docker = require('dockerode');

try {
  let docker = new Docker({
    host: "127.0.0.1",
    protocol: "ssh",
    username: "root",
    sshOptions: {
      host: "127.0.0.1",
      port: 4556,
    }
  });
  console.log('created')
  docker.ping()
    .then(()=>{console.log("ping ok")})
    .catch(()=>{console.error("ping failed")});
} catch (error) {
  console.error("catch", error);  
}

setInterval(()=>console.log(+new Date()), 60000)