// Keep credentials off argv while preserving libpq URI connection options.
export function libpqEnvironment(dsn) {
  const url = new URL(dsn);
  const env = {
    ...process.env,
    PGHOST: decodeURIComponent(url.hostname.replace(/^\[|\]$/g, '')), PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGOPTIONS: '',
  };
  const parameters = {
    host: 'PGHOST', hostaddr: 'PGHOSTADDR', port: 'PGPORT', dbname: 'PGDATABASE',
    user: 'PGUSER', password: 'PGPASSWORD', passfile: 'PGPASSFILE',
    sslmode: 'PGSSLMODE', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslrootcert: 'PGSSLROOTCERT',
    sslcrl: 'PGSSLCRL', sslcrldir: 'PGSSLCRLDIR',
    ssl_min_protocol_version: 'PGSSLMINPROTOCOLVERSION', ssl_max_protocol_version: 'PGSSLMAXPROTOCOLVERSION',
    sslcertmode: 'PGSSLCERTMODE', sslsni: 'PGSSLSNI', sslnegotiation: 'PGSSLNEGOTIATION',
    channel_binding: 'PGCHANNELBINDING', require_auth: 'PGREQUIREAUTH',
    connect_timeout: 'PGCONNECT_TIMEOUT', target_session_attrs: 'PGTARGETSESSIONATTRS',
    application_name: 'PGAPPNAME', client_encoding: 'PGCLIENTENCODING', options: 'PGOPTIONS',
    service: 'PGSERVICE', gssencmode: 'PGGSSENCMODE', krbsrvname: 'PGKRBSRVNAME',
    requirepeer: 'PGREQUIREPEER', load_balance_hosts: 'PGLOADBALANCEHOSTS',
  };
  for (const [key, value] of url.searchParams) {
    if (!parameters[key]) throw new Error(`Unsupported libpq URI option: ${key}`);
    env[parameters[key]] = value;
  }
  return env;
}
