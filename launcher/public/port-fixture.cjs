// Used only by test-lifecycle.ps1 to verify occupied-port safety.
require('http').createServer((_req, res) => res.end('unrelated test service')).listen(3000, '127.0.0.1');
