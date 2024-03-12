# On local machine, run the following and then open chrome debugger.
# ssh -L 9229:127.0.0.1:9229 ubuntu@107.21.224.121 -N -i ~/etc/ec2-keypair.pem
#node --inspect --max-old-space-size=128 urlwatcher.js -p 4444 -c conf/hapi/hapi-config.json
node --max-old-space-size=128 urlwatcher.js -p 4444 -c conf/hapi/hapi-config.json -d
