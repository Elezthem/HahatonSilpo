const https = require('https');

// 1. Get OAuth protected resource metadata
const req = https.request({
  hostname: 'mcp.silpo.ua',
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'GET',
  headers: { 'Accept': 'application/json' }
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('=== Protected Resource Metadata ===');
    console.log('Status:', res.statusCode);
    console.log('Body:', body.substring(0, 2000));
    
    const data = JSON.parse(body);
    if (data.authorization_servers) {
      console.log('\nAuthorization servers:', data.authorization_servers);
      // Get auth server metadata
      const authServerUrl = data.authorization_servers[0];
      const parsed = new URL(authServerUrl);
      const req2 = https.request({
        hostname: parsed.hostname,
        path: '/.well-known/oauth-authorization-server',
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }, res2 => {
        let body2 = '';
        res2.on('data', c => body2 += c);
        res2.on('end', () => {
          console.log('\n=== Auth Server Metadata ===');
          console.log('Status:', res2.statusCode);
          console.log('Body:', body2.substring(0, 3000));
        });
      });
      req2.end();
    }
  });
});
req.on('error', e => console.log('Error:', e.message));
req.end();
