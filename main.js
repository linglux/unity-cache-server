const cluster = require('cluster');
const helpers = require('./lib/helpers');
const consts = require('./lib/constants').Constants;
const program = require('commander');
const path = require('path');
const CacheServer = require('./lib/server');
const config = require('config');
const prompt = require('prompt');

function myParseInt(val, def) {
    val = parseInt(val);
    return (!val && val !== 0) ? def : val;
}

function zeroOrMore(val) {
    return Math.max(0, val);
}

const moduleName = config.get("Cache.module");
const CacheModule = require(path.resolve(config.get("Cache.path"), moduleName));
const Cache = new CacheModule();

program.description("Unity Cache Server")
    .version(consts.VERSION)
    .option('-p, --port <n>', `Specify the server port, only apply to new cache server, default is ${consts.DEFAULT_PORT}`, myParseInt, consts.DEFAULT_PORT)
    .option('-P, --cachePath [path]', `Specify the path of the cache directory. Default is .${moduleName}`, `.${moduleName}`)
    .option('-l, --log-level <n>', `Specify the level of log verbosity. Valid values are 0 (silent) through 5 (debug). Default is ${consts.DEFAULT_LOG_LEVEL}`, myParseInt, consts.DEFAULT_LOG_LEVEL)
    .option('-w, --workers <n>', `Number of worker threads to spawn. Default is ${consts.DEFAULT_WORKERS}`, zeroOrMore, consts.DEFAULT_WORKERS)
    .option('-m, --monitor-parent-process <n>', 'Monitor a parent process and exit if it dies', myParseInt, 0);

program.parse(process.argv);

helpers.SetLogLevel(program.logLevel);

if (program.monitorParentProcess > 0) {
    function monitor() {
        function is_running(pid) {
            try {
                return process.kill(pid, 0)
            }
            catch (e) {
                return e.code === 'EPERM'
            }
        }

        if (!is_running(program.monitorParentProcess)) {
            helpers.log(consts.LOG_INFO, "monitored parent process has died");
            process.exit(1);
        }
        setTimeout(monitor, 1000);
    }

    monitor();
}

const errHandler = function () {
    helpers.log(consts.LOG_ERR, "Unable to start Cache Server");
    process.exit(1);
};

if(!CacheModule.properties.clustering) {
    program.workers = 0;
    helpers.log(consts.LOG_INFO, `Clustering disabled, ${moduleName} module does not support it.`);
}

let server = null;

let cacheOpts = {
    cachePath: program.cachePath
};

Cache.init(cacheOpts, function(error) {
    if(error) {
        helpers.log(consts.LOG_ERR, error);
        process.exit(1);
    }

    server = new CacheServer(Cache, program.port);

    if(cluster.isMaster) {
        helpers.log(consts.LOG_INFO, "Cache Server version " + consts.VERSION);

        if(program.workers === 0) {
            server.Start(errHandler, function () {
                helpers.log(consts.LOG_INFO, `Cache Server ready on port ${server.port}`);
                startPrompt();
            });
        }

        for(let i = 0; i < program.workers; i++) {
            const worker = cluster.fork();
            Cache.registerClusterWorker(worker);
        }
    }
    else {
        server.Start(errHandler, function () {
            helpers.log(consts.LOG_INFO, `Cache Server worker ${cluster.worker.id} ready on port ${server.port}`);
        });
    }
});

function startPrompt() {
    prompt.message = "";
    prompt.delimiter = "> ";
    prompt.start();

    prompt.get(['command'], function(err, result) {
        if(err) {
            if(err.message === 'canceled') {
                result = { command: 'q' };
            }
            else {
                helpers.log(consts.LOG_ERR, err);
                server.Stop();
                process.exit(1);
            }
        }

        if(result) {
            switch(result.command) {
                case 'q':
                    helpers.log(consts.LOG_INFO, "Shutting down ...");
                    Cache.shutdown(function () {
                        server.Stop();
                        process.exit(0);
                    });
                    break;

                case 's':
                    helpers.log(consts.LOG_INFO, "Saving cache data ...");
                    Cache.save(function(err) {
                        if(err) {
                            helpers.log(consts.LOG_ERR, err);
                            server.Stop();
                            process.exit(1);
                        }

                        helpers.log(consts.LOG_INFO, "Save finished.");
                    });

                    break;
                case 'r':
                    helpers.log(consts.LOG_INFO, "Resetting cache data ...");
                    Cache.reset(function(err) {
                        "use strict";
                        if(err) {
                            helpers.log(consts.LOG_ERR, err);
                            server.Stop();
                            process.exit(1);
                        }

                        helpers.log(consts.LOG_INFO, "Reset finished.");
                    });
            }
        }

        process.nextTick(startPrompt);
    });
}



