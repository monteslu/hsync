# hsync

[![NPM](https://nodei.co/npm/hsync.svg)](https://nodei.co/npm/hsync/)

hsync is a [reverse-proxy](https://en.wikipedia.org/wiki/Reverse_proxy) client for node.js and browsers that connects to an [hsync-server](https://github.com/monteslu/hsync-server).

You can share your local webserver as a secure public URL, as well as tunnel whatever tcp/ip traffic you'd like between two hsync clients.


## basic usage

## install globally
`npm i -g hsync`

### run
`hsync`

## run with npx

`npx hsync`

## configuration

by default hsync will connect to the default hsync.tech server and allow a connection for up to 4 hours.

However you can pass flags to the command line or configure env variables:

| flag | long flag              | type    | env variable       | description                                                |
| ---- | ---------------------  | ------- | ------------------ | ---------------------------------------------------------- |
| -p   | -port                  | number  | PORT               | port for local webserver                                   |  
| -d   | --dynamic-host         | url     | HSYNC_DYNAMIC_HOST | host to get a dynamic connection from                      |
| -s   | --hsync-server         | url     | HSYNC_SERVER       | hsync-server location ex: wss://sub.mydomain.com           |
| -hs  | --hsync-secret         | string  | HSYNC_SECRET       | password to connect to hsync-server                        |
| -llp | --listener-local-port  | number  | HSYNC_LLP          | local port to open for listener                            |
| -lth | --listener-target-host | url     | HSYNC_LTH          | target host for listener                                   |
| -ltp | --listener-target-port | number  | HSYNC_LTP          | target port for listener                                   |
| -rip | --relay-inbound-port   | number  | HSYNC_RIP          | inbound port for remote relay requests                     |
| -rth | --relay-target-host    | url     | HSYNC_RTH          | target host for relay to open tcp connection on            |
| -rtp | --relay-target-port    | number  | HSYNC_RTP          | target port for relay to open tcp connection on            |



