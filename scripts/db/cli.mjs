// Shared CLI flags for the database scripts: `--flag` and `--flag value`.
export function cliArgs(argv = process.argv.slice(2)) {
  return {
    has: (flag) => argv.includes(flag),
    value: (flag, fallback) => {
      const index = argv.indexOf(flag);
      return index === -1 ? fallback : argv[index + 1];
    },
  };
}
