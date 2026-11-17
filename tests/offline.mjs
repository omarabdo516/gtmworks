// What a test may reach (#266): this machine, and the special-use names of RFC 6761, which are never delegated, so no
// request to them can reach an outside server. Everything else is outside, example.com and private LAN ranges included.
const localNames = [/^localhost$/, /\.(localhost|test|example|invalid)$/];
const localAddresses = [/^127(\.\d{1,3}){3}$/, /^::1$/, /^::ffff:(127(\.\d{1,3}){3}|7f[0-9a-f]{2}:[0-9a-f]{1,4})$/, /^0\.0\.0\.0$/, /^::$/];

export const isLocalHost = host => {
  const name = String(host).toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  return [...localNames, ...localAddresses].some(pattern => pattern.test(name));
};

export const isLocalUrl = url => {
  const { protocol, hostname } = new URL(url);
  return !['http:', 'https:', 'ws:', 'wss:'].includes(protocol) || isLocalHost(hostname);
};
