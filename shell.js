const net = require('net');

function run(port = 2323) {
  process.stdin.setRawMode( true );
  console.log('connecting to localhost:', port, ' ...');

  const client = net.createConnection({ port }, () => {
    client.on('data', (data) => {
      process.stdout.write(data);
    });

    process.stdin.on('data', (data) => {
      client.write(data);
      // ctrl-c ( end of text )
      if ( String(data) === '\u0003' ) {
        process.exit();
      }
    });

    client.on('end', () => {
      console.log('disconnected from server');
      process.exit();
    });

    client.on('error', (err) => {
      console.error(err);
    });
    
  });
}

module.exports = run;

